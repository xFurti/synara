// FILE: BakeoffSplitBanner.tsx
// Purpose: Split-only bake-off chrome: providers vs prompt, compare diffs, keep one.
// Layer: Chat split UI

import { PROVIDER_DISPLAY_NAMES } from "@synara/contracts";
import { useQuery } from "@tanstack/react-query";

import { Button } from "../ui/button";
import { useThreadBakeoff } from "../../hooks/useThreadBakeoff";
import { classifyBakeoffDiffPaths } from "../../lib/bakeoffDiffCompare";
import { gitStatusQueryOptions } from "../../lib/gitReactQuery";
import { useStore } from "../../store";
import { getThreadFromState } from "../../threadDerivation";
import { cn } from "../../lib/utils";
import type { PaneId, SplitView } from "../../splitViewStore";
import { collectLeaves } from "../../splitView.logic";

export function BakeoffSplitBanner(props: {
  splitView: SplitView;
  onOpenDiffs: (filePath?: string) => void;
}) {
  const leaves = collectLeaves(props.splitView.root);
  const leftThreadId = leaves[0]?.threadId ?? null;
  const rightThreadId = leaves[1]?.threadId ?? null;
  const leftThread = useStore((store) =>
    leftThreadId ? (getThreadFromState(store, leftThreadId) ?? null) : null,
  );
  const rightThread = useStore((store) =>
    rightThreadId ? (getThreadFromState(store, rightThreadId) ?? null) : null,
  );
  const experimentId = leftThread?.bakeoff?.experimentId;
  const isBakeoffPair =
    Boolean(experimentId) && rightThread?.bakeoff?.experimentId === experimentId;
  const { keepBakeoffPeer } = useThreadBakeoff();

  const leftStatus = useQuery(
    gitStatusQueryOptions(leftThread?.worktreePath ?? null, isBakeoffPair),
  );
  const rightStatus = useQuery(
    gitStatusQueryOptions(rightThread?.worktreePath ?? null, isBakeoffPair),
  );

  if (!isBakeoffPair || !leftThread || !rightThread) {
    return null;
  }

  const paths = classifyBakeoffDiffPaths(
    leftStatus.data?.workingTree.files ?? [],
    rightStatus.data?.workingTree.files ?? [],
  );
  const prompt = leftThread.bakeoff?.prompt ?? rightThread.bakeoff?.prompt ?? "";

  return (
    <div className="flex shrink-0 flex-col gap-1.5 border-b border-[color:var(--color-border-light)] bg-[var(--composer-surface)] px-3 py-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="min-w-0">
          <p className="truncate text-[length:var(--app-font-size-ui,12px)] font-medium">
            {PROVIDER_DISPLAY_NAMES[leftThread.modelSelection.provider]} vs{" "}
            {PROVIDER_DISPLAY_NAMES[rightThread.modelSelection.provider]}
          </p>
          {prompt ? (
            <p className="truncate text-[length:var(--app-font-size-ui-xs,10px)] text-muted-foreground">
              {prompt}
            </p>
          ) : null}
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          <Button size="xs" variant="outline" onClick={() => props.onOpenDiffs()}>
            Compare diffs
          </Button>
          <Button size="xs" variant="outline" onClick={() => void keepBakeoffPeer(leftThread.id)}>
            Keep {PROVIDER_DISPLAY_NAMES[leftThread.modelSelection.provider]}
          </Button>
          <Button size="xs" variant="outline" onClick={() => void keepBakeoffPeer(rightThread.id)}>
            Keep {PROVIDER_DISPLAY_NAMES[rightThread.modelSelection.provider]}
          </Button>
        </div>
      </div>
      {paths.length > 0 ? (
        <div className="flex flex-wrap gap-1">
          {paths.slice(0, 24).map((entry) => (
            <button
              key={entry.path}
              type="button"
              className={cn(
                "max-w-full truncate rounded-md px-1.5 py-0.5 text-[length:var(--app-font-size-ui-xs,10px)]",
                entry.kind === "both"
                  ? "bg-[var(--color-background-button-secondary-hover)]"
                  : "bg-transparent text-muted-foreground",
              )}
              title={
                entry.kind === "both"
                  ? "Changed in both"
                  : entry.kind === "left"
                    ? `Only ${PROVIDER_DISPLAY_NAMES[leftThread.modelSelection.provider]}`
                    : `Only ${PROVIDER_DISPLAY_NAMES[rightThread.modelSelection.provider]}`
              }
              onClick={() => props.onOpenDiffs(entry.path)}
            >
              {entry.path}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

export function openBakeoffDiffs(input: {
  splitView: SplitView;
  filePath?: string | undefined;
  setPanePanelState: (
    splitViewId: string,
    paneId: PaneId,
    patch: Partial<{
      panel: "diff";
      diffTurnId: null;
      diffFilePath: string | null;
      hasOpenedPanel: true;
      lastOpenPanel: "diff";
    }>,
  ) => void;
}): void {
  for (const leaf of collectLeaves(input.splitView.root)) {
    input.setPanePanelState(input.splitView.id, leaf.id, {
      panel: "diff",
      diffTurnId: null,
      diffFilePath: input.filePath ?? null,
      hasOpenedPanel: true,
      lastOpenPanel: "diff",
    });
  }
}
