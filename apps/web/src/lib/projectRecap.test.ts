import assert from "node:assert/strict";
import { describe, it } from "vitest";
import { ThreadId, ProjectId } from "@synara/contracts";

import { deriveProjectRecap } from "./projectRecap";
import { DEFAULT_INTERACTION_MODE, type SidebarThreadSummary } from "../types";

function thread(
  partial: Partial<SidebarThreadSummary> & Pick<SidebarThreadSummary, "id" | "title">,
): SidebarThreadSummary {
  return {
    projectId: ProjectId.makeUnsafe("11111111-1111-4111-8111-111111111111"),
    modelSelection: { provider: "codex", model: "gpt-5.4" },
    interactionMode: DEFAULT_INTERACTION_MODE,
    branch: null,
    worktreePath: null,
    session: null,
    createdAt: "2026-08-20T00:00:00.000Z",
    latestTurn: null,
    latestUserMessageAt: null,
    hasPendingApprovals: false,
    hasPendingUserInput: false,
    hasActionableProposedPlan: false,
    hasLiveTailWork: false,
    ...partial,
  };
}

describe("deriveProjectRecap", () => {
  it("counts waiting over working and ignores archived and subagent threads", () => {
    const recap = deriveProjectRecap([
      thread({
        id: ThreadId.makeUnsafe("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1"),
        title: "Needs approval",
        hasPendingApprovals: true,
      }),
      thread({
        id: ThreadId.makeUnsafe("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2"),
        title: "Archived",
        archivedAt: "2026-08-20T01:00:00.000Z",
        hasPendingApprovals: true,
      }),
      thread({
        id: ThreadId.makeUnsafe("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa3"),
        title: "Child",
        parentThreadId: ThreadId.makeUnsafe("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1"),
        hasLiveTailWork: true,
      }),
    ]);
    assert.equal(recap.waiting, 1);
    assert.equal(recap.working, 0);
    assert.equal(recap.headlines[0]?.title, "Needs approval");
  });

  it("treats conflicting PRs as blocked and caps PR chips", () => {
    const recap = deriveProjectRecap([
      thread({
        id: ThreadId.makeUnsafe("bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1"),
        title: "Conflict",
        lastKnownPr: {
          number: 12,
          title: "Fix conflict",
          url: "https://github.com/org/repo/pull/12",
          baseBranch: "main",
          headBranch: "fix",
          state: "open",
          mergeability: "conflicting",
        },
      }),
    ]);
    assert.equal(recap.blocked, 1);
    assert.equal(recap.pullRequests.length, 1);
    assert.equal(recap.pullRequests[0]?.number, 12);
  });
});
