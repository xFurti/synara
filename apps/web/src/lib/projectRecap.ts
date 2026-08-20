// FILE: projectRecap.ts
// Purpose: Derive a project-level resume glance from existing sidebar thread summaries.

import type { OrchestrationThreadPullRequest } from "@synara/contracts";
import { canSessionAnswerPendingRequests } from "../session-logic";
import type { SidebarThreadSummary } from "../types";
import { isThreadActivelyWorking } from "../components/Sidebar.logic";

export type ProjectRecapLane = "waiting" | "working" | "blocked";

export type ProjectRecapHeadline = {
  readonly threadId: SidebarThreadSummary["id"];
  readonly title: string;
  readonly lane: ProjectRecapLane;
};

export type ProjectRecapPrChip = {
  readonly key: string;
  readonly number: number | null;
  readonly state: OrchestrationThreadPullRequest["state"] | string;
  readonly url: string | null;
  readonly isDraft: boolean;
};

export type ProjectRecap = {
  readonly waiting: number;
  readonly working: number;
  readonly blocked: number;
  readonly headlines: readonly ProjectRecapHeadline[];
  readonly pullRequests: readonly ProjectRecapPrChip[];
  readonly extraPullRequestCount: number;
};

function isEligibleRecapThread(thread: SidebarThreadSummary): boolean {
  if (thread.parentThreadId) return false;
  if ((thread.archivedAt ?? null) !== null) return false;
  return true;
}

function isWaiting(thread: SidebarThreadSummary): boolean {
  if (!canSessionAnswerPendingRequests(thread.session)) return false;
  return (
    thread.hasPendingApprovals ||
    thread.hasPendingUserInput ||
    (thread.hasActionableProposedPlan && thread.interactionMode === "plan")
  );
}

function isWorking(thread: SidebarThreadSummary): boolean {
  return isThreadActivelyWorking(thread) || thread.session?.status === "connecting";
}

function isBlocked(thread: SidebarThreadSummary): boolean {
  return thread.lastKnownPr?.mergeability === "conflicting";
}

function laneFor(thread: SidebarThreadSummary): ProjectRecapLane | null {
  if (isWaiting(thread)) return "waiting";
  if (isWorking(thread)) return "working";
  if (isBlocked(thread)) return "blocked";
  return null;
}

function prKey(pr: OrchestrationThreadPullRequest): string {
  if (pr.url?.trim()) return pr.url.trim();
  return `${pr.number ?? ""}:${pr.headBranch ?? ""}`;
}

export function deriveProjectRecap(
  threads: readonly SidebarThreadSummary[],
): ProjectRecap {
  let waiting = 0;
  let working = 0;
  let blocked = 0;
  const headlines: ProjectRecapHeadline[] = [];
  const prs: ProjectRecapPrChip[] = [];
  const seenPrs = new Set<string>();

  for (const thread of threads) {
    if (!isEligibleRecapThread(thread)) continue;
    const lane = laneFor(thread);
    if (lane) {
      if (lane === "waiting") waiting += 1;
      else if (lane === "working") working += 1;
      else blocked += 1;
      if (headlines.length < 3) {
        headlines.push({ threadId: thread.id, title: thread.title, lane });
      }
    }
    const pr = thread.lastKnownPr;
    if (pr && pr.state === "open") {
      const key = prKey(pr);
      if (!seenPrs.has(key)) {
        seenPrs.add(key);
        prs.push({
          key,
          number: pr.number ?? null,
          state: pr.state,
          url: pr.url ?? null,
          isDraft: pr.isDraft === true,
        });
      }
    }
  }

  const laneRank: Record<ProjectRecapLane, number> = { waiting: 0, blocked: 1, working: 2 };
  headlines.sort((left, right) => laneRank[left.lane] - laneRank[right.lane]);

  return {
    waiting,
    working,
    blocked,
    headlines: headlines.slice(0, 3),
    pullRequests: prs.slice(0, 3),
    extraPullRequestCount: Math.max(0, prs.length - 3),
  };
}

export function projectRecapHasOpenWork(recap: ProjectRecap): boolean {
  return recap.waiting + recap.working + recap.blocked > 0;
}
