// FILE: threadBakeoff.ts
// Purpose: Client coordinator for a two-provider worktree bake-off.
// Layer: Web orchestration helper
// Exports: pair lookup, titles, and keep/discard helpers

import {
  PROVIDER_DISPLAY_NAMES,
  type ModelSelection,
  type ProviderKind,
  type ThreadBakeoff,
  type ThreadId,
} from "@synara/contracts";

import { DEFAULT_PROVIDER_ORDER } from "../providerOrdering";
import type { Thread } from "../types";

export function isBakeoffPeerThread(
  thread: Pick<Thread, "bakeoff" | "parentThreadId" | "sidechatSourceThreadId"> | null | undefined,
): boolean {
  return Boolean(thread?.bakeoff);
}

export function canOfferBakeoff(input: {
  readonly isGitRepo: boolean;
  readonly thread: Pick<
    Thread,
    "bakeoff" | "parentThreadId" | "sidechatSourceThreadId" | "archivedAt"
  > | null;
  readonly otherUsableProviderCount: number;
}): boolean {
  if (!input.isGitRepo || input.otherUsableProviderCount < 1) {
    return false;
  }
  if (!input.thread) {
    return true;
  }
  if (input.thread.archivedAt) {
    return false;
  }
  if (input.thread.bakeoff) {
    return false;
  }
  if (input.thread.parentThreadId) {
    return false;
  }
  if (input.thread.sidechatSourceThreadId) {
    return false;
  }
  return true;
}

export function findBakeoffPeer<T extends Pick<Thread, "id" | "bakeoff">>(
  threads: readonly T[],
  thread: Pick<Thread, "id" | "bakeoff">,
): T | null {
  const experimentId = thread.bakeoff?.experimentId;
  const peerThreadId = thread.bakeoff?.peerThreadId;
  if (!experimentId || !peerThreadId) {
    return null;
  }
  return (
    threads.find(
      (candidate) =>
        candidate.id === peerThreadId && candidate.bakeoff?.experimentId === experimentId,
    ) ?? null
  );
}

export function bakeoffThreadTitle(input: {
  readonly prompt: string;
  readonly provider: ProviderKind;
}): string {
  const preview = input.prompt.trim().replace(/\s+/g, " ");
  const providerLabel = PROVIDER_DISPLAY_NAMES[input.provider];
  if (preview.length === 0) {
    return `Bake-off · ${providerLabel}`;
  }
  const clipped = preview.length > 48 ? `${preview.slice(0, 45).trimEnd()}…` : preview;
  return `${clipped} · ${providerLabel}`;
}

export function resolveBakeoffProviders(input: {
  readonly currentProvider: ProviderKind;
  readonly requestedProviders: ReadonlyArray<ProviderKind>;
  readonly usableProviders: ReadonlyArray<ProviderKind>;
}): {
  readonly left: ProviderKind | null;
  readonly right: ProviderKind | null;
  readonly unavailable: ProviderKind | null;
} {
  const usable = input.usableProviders.filter(
    (provider, index, all) => all.indexOf(provider) === index,
  );
  const requested = input.requestedProviders.filter(
    (provider, index, all) => all.indexOf(provider) === index,
  );

  if (requested.length >= 2) {
    const left = requested[0]!;
    const right = requested[1]!;
    if (left === right) {
      return { left: null, right: null, unavailable: null };
    }
    const leftUsable = usable.includes(left) ? left : null;
    const rightUsable = usable.includes(right) ? right : null;
    return {
      left: leftUsable,
      right: rightUsable,
      unavailable: leftUsable ? (rightUsable ? null : right) : left,
    };
  }

  if (requested.length === 1) {
    const other = requested[0]!;
    if (other === input.currentProvider) {
      return { left: null, right: null, unavailable: null };
    }
    const left = usable.includes(input.currentProvider) ? input.currentProvider : null;
    const right = usable.includes(other) ? other : null;
    return {
      left,
      right,
      unavailable: left ? (right ? null : other) : input.currentProvider,
    };
  }

  const left = usable.includes(input.currentProvider) ? input.currentProvider : null;
  const right =
    usable.find((provider) => provider !== input.currentProvider) ??
    DEFAULT_PROVIDER_ORDER.find(
      (provider) => provider !== input.currentProvider && usable.includes(provider),
    ) ??
    null;
  if (!left || !right) {
    return { left, right, unavailable: right ? input.currentProvider : null };
  }
  return { left, right, unavailable: null };
}

export function buildBakeoffPair(input: {
  readonly experimentId: string;
  readonly prompt: string;
  readonly baseRef: string;
  readonly sourceThreadId: ThreadId | null;
  readonly leftThreadId: ThreadId;
  readonly rightThreadId: ThreadId;
}): { readonly left: ThreadBakeoff; readonly right: ThreadBakeoff } {
  const shared = {
    experimentId: input.experimentId,
    sourceThreadId: input.sourceThreadId,
    prompt: input.prompt,
    baseRef: input.baseRef,
    status: "running" as const,
  };
  return {
    left: {
      ...shared,
      peerThreadId: input.rightThreadId,
      role: "left",
    },
    right: {
      ...shared,
      peerThreadId: input.leftThreadId,
      role: "right",
    },
  };
}

export function keepBakeoffStatuses(winnerRole: "left" | "right"): {
  readonly winner: ThreadBakeoff["status"];
  readonly loser: ThreadBakeoff["status"];
} {
  return { winner: "kept", loser: "discarded" };
}

export function bakeoffKeepConfirmMessage(input: {
  readonly winnerProvider: ProviderKind;
  readonly loserProvider: ProviderKind;
}): string {
  return `Keep ${PROVIDER_DISPLAY_NAMES[input.winnerProvider]}?\nThe ${PROVIDER_DISPLAY_NAMES[input.loserProvider]} worktree will be archived and removed.`;
}

export function resolveBakeoffModelSelection(input: {
  readonly provider: ProviderKind;
  readonly current: ModelSelection | null | undefined;
  readonly sticky: ModelSelection | null | undefined;
  readonly projectDefault: ModelSelection | null | undefined;
  readonly fallback: ModelSelection;
}): ModelSelection {
  if (input.current?.provider === input.provider) {
    return input.current;
  }
  if (input.sticky?.provider === input.provider) {
    return input.sticky;
  }
  if (input.projectDefault?.provider === input.provider) {
    return input.projectDefault;
  }
  return input.fallback;
}
