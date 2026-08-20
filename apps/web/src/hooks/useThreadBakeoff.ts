// FILE: useThreadBakeoff.ts
// Purpose: Runs a two-provider worktree bake-off from /bakeoff and keep/discard.
// Layer: Web hook
// Reuses promoteThreadCreate, detached worktrees, split view, and archive.

import { PROVIDER_DISPLAY_NAMES, type ProviderKind, type ThreadId } from "@synara/contracts";
import { buildPromptThreadTitleFallback } from "@synara/shared/chatThreads";
import { buildTemporaryWorktreeBranchName } from "@synara/shared/git";
import { getDefaultModel } from "@synara/shared/model";
import { useNavigate } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import { useCallback } from "react";

import { showConfirmDialogFallback } from "../confirmDialogFallback";
import { useComposerDraftStore } from "../composerDraftStore";
import { toastManager } from "../components/ui/toast";
import { readNativeApi } from "../nativeApi";
import { useSplitViewStore } from "../splitViewStore";
import { useStore } from "../store";
import { getThreadFromState } from "../threadDerivation";
import type { Project, Thread } from "../types";
import { newCommandId, newMessageId, newThreadId, randomUUID } from "../lib/utils";
import { archiveThreadFromClient } from "../lib/threadArchive";
import { promoteThreadCreate } from "../lib/threadCreatePromotion";
import { resolveThreadHandoffModelSelection } from "../lib/threadHandoff";
import {
  bakeoffKeepConfirmMessage,
  bakeoffThreadTitle,
  buildBakeoffPair,
  findBakeoffPeer,
  resolveBakeoffProviders,
} from "../lib/threadBakeoff";
import { DEFAULT_INTERACTION_MODE, DEFAULT_RUNTIME_MODE } from "../types";

export function useThreadBakeoff() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const createFromDrop = useSplitViewStore((store) => store.createFromDrop);
  const removeThreadFromSplitViews = useSplitViewStore((store) => store.removeThreadFromSplitViews);

  const startBakeoff = useCallback(
    async (input: {
      readonly project: Project;
      readonly sourceThread: Thread | undefined;
      readonly currentProvider: ProviderKind;
      readonly requestedProviders: ReadonlyArray<ProviderKind>;
      readonly usableProviders: ReadonlyArray<ProviderKind>;
      readonly prompt: string;
      readonly baseRef: string | null;
      readonly copyChangesFrom: string | null;
    }): Promise<boolean> => {
      const api = readNativeApi();
      if (!api) {
        toastManager.add({
          type: "error",
          title: "Could not start bake-off",
          description: "Synara is not connected.",
        });
        return false;
      }
      const prompt = input.prompt.trim();
      if (!prompt) {
        toastManager.add({
          type: "warning",
          title: "Bake-off needs a prompt",
          description: "Write the objective in the composer, or pass it after /bakeoff.",
        });
        return false;
      }
      if (!input.baseRef) {
        toastManager.add({
          type: "warning",
          title: "Bake-off needs a Git branch",
          description: "Open a Git project so both arms can pin to the same base.",
        });
        return false;
      }

      const resolved = resolveBakeoffProviders({
        currentProvider: input.currentProvider,
        requestedProviders: input.requestedProviders,
        usableProviders: input.usableProviders,
      });
      const providers = [resolved.left, resolved.right].filter(
        (provider): provider is ProviderKind => provider !== null,
      );
      if (providers.length === 0) {
        toastManager.add({
          type: "warning",
          title: "No bake-off providers",
          description: "Enable and sign in to two providers, then run /bakeoff again.",
        });
        return false;
      }
      if (resolved.unavailable) {
        toastManager.add({
          type: "warning",
          title: `${PROVIDER_DISPLAY_NAMES[resolved.unavailable]} is unavailable`,
          description: "The usable provider will still run in its own worktree.",
        });
      }

      const experimentId = randomUUID();
      const leftThreadId = newThreadId();
      const rightThreadId = providers[1] ? newThreadId() : leftThreadId;
      const pair = buildBakeoffPair({
        experimentId,
        prompt,
        baseRef: input.baseRef,
        sourceThreadId: input.sourceThread?.id ?? null,
        leftThreadId,
        rightThreadId,
      });
      const sticky = useComposerDraftStore.getState().stickyModelSelectionByProvider;
      const created: Array<{
        readonly threadId: ThreadId;
        readonly worktreePath: string | null;
        readonly provider: ProviderKind;
      }> = [];

      const createArm = async (
        provider: ProviderKind,
        role: "left" | "right",
        threadId: ThreadId,
        bakeoff: typeof pair.left,
      ) => {
        const newBranch = buildTemporaryWorktreeBranchName();
        let worktreePath: string | null = null;
        let worktreeBranch: string | null = newBranch;
        try {
          const result = await api.git.createDetachedWorktree({
            cwd: input.project.cwd,
            ref: input.baseRef!,
            path: null,
            newBranch,
            ...(input.copyChangesFrom ? { copyChangesFrom: input.copyChangesFrom } : {}),
          });
          worktreePath = result.worktree.path;
          worktreeBranch = result.worktree.branch ?? newBranch;
        } catch (error) {
          toastManager.add({
            type: "warning",
            title: `Could not create the ${PROVIDER_DISPLAY_NAMES[provider]} worktree`,
            description: error instanceof Error ? error.message : "Worktree creation failed.",
          });
        }

        const defaultModel = getDefaultModel(provider);
        if (!defaultModel) {
          throw new Error(`Select a model before using ${PROVIDER_DISPLAY_NAMES[provider]}.`);
        }
        const modelSelection = resolveThreadHandoffModelSelection({
          sourceThread: input.sourceThread ?? { modelSelection: { provider, model: defaultModel } },
          targetProvider: provider,
          projectDefaultModelSelection: input.project.defaultModelSelection,
          stickyModelSelectionByProvider: sticky,
        });
        const title = bakeoffThreadTitle({
          prompt: buildPromptThreadTitleFallback(prompt),
          provider,
        });
        await promoteThreadCreate({
          type: "thread.create",
          commandId: newCommandId(),
          threadId,
          projectId: input.project.id,
          title,
          modelSelection,
          runtimeMode: input.sourceThread?.runtimeMode ?? DEFAULT_RUNTIME_MODE,
          interactionMode: input.sourceThread?.interactionMode ?? DEFAULT_INTERACTION_MODE,
          envMode: "worktree",
          branch: worktreeBranch,
          worktreePath,
          workingDirectory: worktreePath,
          associatedWorktreePath: worktreePath,
          associatedWorktreeBranch: worktreeBranch,
          associatedWorktreeRef: input.baseRef,
          createBranchFlowCompleted: worktreePath !== null,
          parentThreadId: null,
          creationSource: "bakeoff",
          sourceThreadId: input.sourceThread?.id,
          bakeoff: {
            ...bakeoff,
            status: worktreePath ? "running" : "failed",
          },
          lastKnownPr: null,
          createdAt: new Date().toISOString(),
        });
        if (worktreePath) {
          await api.orchestration.dispatchCommand({
            type: "thread.turn.start",
            commandId: newCommandId(),
            threadId,
            message: {
              messageId: newMessageId(),
              role: "user",
              text: prompt,
              attachments: [],
            },
            modelSelection,
            dispatchMode: "queue",
            runtimeMode: input.sourceThread?.runtimeMode ?? DEFAULT_RUNTIME_MODE,
            interactionMode: input.sourceThread?.interactionMode ?? DEFAULT_INTERACTION_MODE,
            createdAt: new Date().toISOString(),
          });
        }
        created.push({ threadId, worktreePath, provider });
        void role;
      };

      try {
        await createArm(providers[0]!, "left", leftThreadId, pair.left);
        if (providers[1]) {
          await createArm(providers[1], "right", rightThreadId, pair.right);
        }
      } catch (error) {
        for (const arm of created) {
          if (arm.worktreePath) {
            await api.git
              .removeWorktree({
                cwd: input.project.cwd,
                path: arm.worktreePath,
                force: true,
                reclaimTemporaryBranch: true,
              })
              .catch(() => undefined);
          }
        }
        toastManager.add({
          type: "error",
          title: "Could not start bake-off",
          description: error instanceof Error ? error.message : "Bake-off creation failed.",
        });
        return false;
      }

      if (created.length === 0) {
        toastManager.add({
          type: "error",
          title: "Could not start bake-off",
          description: "Neither worktree could be created.",
        });
        return false;
      }

      const first = created[0]!;
      const second = created[1];
      if (second) {
        const splitViewId = createFromDrop({
          sourceThreadId: first.threadId,
          droppedThreadId: second.threadId,
          direction: "horizontal",
          side: "second",
          ownerProjectId: input.project.id,
        });
        await navigate({
          to: "/$threadId",
          params: { threadId: first.threadId },
          search: () => ({ splitViewId }),
        });
      } else {
        await navigate({
          to: "/$threadId",
          params: { threadId: first.threadId },
        });
      }
      void queryClient;
      return true;
    },
    [createFromDrop, navigate, queryClient],
  );

  const keepBakeoffPeer = useCallback(
    async (winnerThreadId: ThreadId): Promise<boolean> => {
      const api = readNativeApi();
      if (!api) return false;
      const state = useStore.getState();
      const winner = getThreadFromState(state, winnerThreadId);
      if (!winner?.bakeoff) {
        return false;
      }
      const peer = findBakeoffPeer(
        (state.threadIds ?? []).flatMap((id) => {
          const thread = getThreadFromState(state, id);
          return thread ? [thread] : [];
        }),
        winner,
      );
      if (!peer) {
        toastManager.add({
          type: "warning",
          title: "Bake-off peer missing",
          description: "The other arm is no longer on this Synara.",
        });
        return false;
      }
      const confirmed = await showConfirmDialogFallback(
        bakeoffKeepConfirmMessage({
          winnerProvider: winner.modelSelection.provider,
          loserProvider: peer.modelSelection.provider,
        }),
      );
      if (!confirmed) {
        return false;
      }

      if (peer.latestTurn?.state === "running" || peer.session?.status === "running") {
        await api.orchestration
          .dispatchCommand({
            type: "thread.turn.interrupt",
            commandId: newCommandId(),
            threadId: peer.id,
            createdAt: new Date().toISOString(),
          })
          .catch(() => undefined);
      }

      await api.orchestration.dispatchCommand({
        type: "thread.meta.update",
        commandId: newCommandId(),
        threadId: winner.id,
        bakeoff: { ...winner.bakeoff, status: "kept" },
      });
      if (peer.bakeoff) {
        await api.orchestration.dispatchCommand({
          type: "thread.meta.update",
          commandId: newCommandId(),
          threadId: peer.id,
          bakeoff: { ...peer.bakeoff, status: "discarded" },
        });
      }
      await archiveThreadFromClient(api.orchestration, peer.id);
      const project = state.projects.find((candidate) => candidate.id === peer.projectId);
      if (project && peer.worktreePath) {
        await api.git
          .removeWorktree({
            cwd: project.cwd,
            path: peer.worktreePath,
            force: true,
            reclaimTemporaryBranch: true,
          })
          .catch(() => undefined);
      }
      removeThreadFromSplitViews(peer.id);
      await navigate({
        to: "/$threadId",
        params: { threadId: winner.id },
        search: (previous) => ({ ...previous, splitViewId: undefined }),
      });
      toastManager.add({
        type: "success",
        title: `Kept ${PROVIDER_DISPLAY_NAMES[winner.modelSelection.provider]}`,
        description: `${PROVIDER_DISPLAY_NAMES[peer.modelSelection.provider]} archived.`,
      });
      return true;
    },
    [navigate, removeThreadFromSplitViews],
  );

  return { startBakeoff, keepBakeoffPeer };
}
