# Project Recap (v1)

Status: PLAN — research complete, not implemented.
Worktree: `feat/project-recap` at official synara main `e17505500`.
Owner: project-level recap only. Do not touch thread recap generation, kanban UX, or cloud sync.

## Goal

Resume a repository from the sidebar without opening every thread. Show, for one project:

- what is open
- what is working / waiting / blocked
- which threads have a linked PR
- when the project was last used

v1 is a **derived dashboard**, not an LLM summary. An on-demand generated project summary is explicitly extra and out of this PR.

## Why this surface

| Existing surface | What it already does | Why it is not the project recap |
| --- | --- | --- |
| Thread recap (`useThreadRecap` → Environment panel) | LLM recap of **one chat**, localStorage cache, 60s idle debounce, `server.generateThreadRecap` | Thread-scoped; costs a provider call; not a repo resume view |
| Environment notepad / project instructions | Per-thread scratchpad; per-project standing instructions | User-authored, not current work state |
| Sidebar Activity | Cross-project task feed (attention / running / unseen / settled) | You still have to scan threads; it is not project-scoped resume |
| Kanban overview | Draft / In Progress / Done cards per project | Full board, not a glance; do not rewrite it |
| PR list (`/pull-requests`) | GitHub-backed repo PRs, involvement tabs | Network fetch; not thread-task state |
| Thread hover card | Title, status, project, branch, worktree, model | One thread |
| **Project hover card** | Name, pin, chat count, path, Edit project | Already the project glance; currently has no work state |

**v1 placement: extend the existing project hover card.**

Reasons:

1. Smallest new surface. The card is already a `PreviewCard` with interactive controls.
2. Matches the resume motion: hover the repo in the sidebar, see what is open, click into a thread.
3. Environment panel is thread-scoped; a new recap panel would need a project-without-thread chrome.
4. A new sidebar section would compete with Activity and add always-on height.
5. Hover delay is already `0` (`SIDEBAR_HOVER_CARD_TRIGGER_PROPS`). Recap **must already be derived** before hover; the popup only renders a precomputed object.

Do not add a project recap panel, route, or sidebar section in v1.

## Product rules

### Lanes

One exclusive lane per eligible thread. Highest wins:

1. **Waiting** — user must act: pending approval, awaiting input, or plan ready. Reuse `resolveThreadStatusPill` / Activity attention (`canSessionAnswerPendingRequests` already drops dead-session requests).
2. **Working** — live output: `isThreadActivelyWorking` or `session.status === "connecting"`.
3. **Blocked** — idle and stuck without a live user-request:
   - paused goal (`goalPausedAt != null` and the thread has a goal)
   - persisted PR `mergeability === "conflicting"`
4. Everything else (draft, done, settled, idle) is **not** an open recap item.

There is no first-class `"blocked"` thread status in the app today. Do not invent a fourth kanban column. Map from existing flags.

### Eligibility

Same visibility as kanban / sidebar display threads:

- top-level only (`parentThreadId` absent) — subagents are nested work, not project resume items
- not archived
- honor `showAutomationRunThreads` the same way `createSidebarDisplayThreadsSelector` does

Composer-only kanban drafts are out of v1 (they are not in `SidebarThreadSummary`).

### Linked PRs

- Source: `thread.lastKnownPr` already on `SidebarThreadSummary`.
- Keep `state === "open"` (including drafts via `isDraft`).
- Dedupe by `url`, else `number + headBranch`.
- Cap **3** chips; if more, show `+N`.
- **Do not** call `git.status`, `git.resolvePullRequest`, or `pullRequests.list` from this surface.

If a live PR map already exists for **visible** sidebar rows (`useThreadPullRequests` in `Sidebar.tsx`), overlay it when present. Hidden / collapsed history must fall back to `resolveThreadPullRequestFallback` — never expand git-status targets to the whole project.

### Last activity

Reuse `createProjectLastActivityAtSelector` (already subscribed in `Sidebar.tsx`). That selector uses `latestUserMessageAt ?? createdAt` and deliberately ignores `updatedAt` (token-stream churn) and `Project.updatedAt` (metadata only). Format with `formatRelativeTime`.

### Headlines

Up to **3** thread titles, lane order waiting → blocked → working, then recency (`latestUserMessageAt` / `createdAt`). Clicking a headline opens that thread. Title only; do not copy the 4k goal string onto the hover card.

### Empty states

| Condition | Hover card |
| --- | --- |
| 0 chats | Current card: name, `0 chats`, path, Edit. No recap block. |
| Chats exist, all lanes 0, no open linked PRs | After chat count: `Nothing in progress`, then last activity if known. |
| Lanes or open PRs exist | Counts, PR chips, last activity, headlines. |
| Open PRs but no open lanes | PR chips + last activity; omit empty count zeros except the `Nothing in progress` line. |

Do not show `Working 0 · Waiting 0 · Blocked 0`.

## Data sources (already in the client)

| Fact | Source | Notes |
| --- | --- | --- |
| Threads in the project | `sidebarThreadSummaryById` via `deriveSidebarProjectData` / `sortedSidebarThreadsByProjectId` | Collapsed folders already iterate **all** project threads for `projectStatus`. Recap uses that same list, not `visibleEntries`. |
| Working / waiting | `hasLiveTailWork`, `session`, `latestTurn`, `hasPendingApprovals`, `hasPendingUserInput`, `hasActionableProposedPlan`, `interactionMode` | Same as `resolveThreadStatusPill` |
| Linked PR | `lastKnownPr` | `OrchestrationThreadPullRequest` on the shell snapshot |
| Last activity | `createProjectLastActivityAtSelector` | Already in Sidebar |
| Blocked via paused goal | **gap** — `goal` / `goalPausedAt` live on `ThreadShell` / `OrchestrationThreadShell` but are **dropped** from `SidebarThreadSummary` | Plumb compact fields; do not add the 4096-char goal text |
| Environment notes | per-thread, not on the summary | Ignore |
| Project instructions | local `projectInstructionsStore` | Ignore |
| Thread recap cache | `synara:thread-recaps:v1` localStorage | Ignore — thread-only LLM text |
| GitHub PR list | `pullRequests.list` React Query | Do not fetch on hover |
| Live git PR | `useThreadPullRequests` → `git.status` per checkout | Visible rows only; git.status is an expensive read (`RPC_EXPENSIVE_READ_CAPACITY_EXCEEDED`) |

No new WebSocket method. No SQLite migration. No `orchestration.getSnapshot` from the hover path. Shell snapshot already hydrates the client on connect; recap reads the projected store.

## UI

Keep the 16rem hover card (`SIDEBAR_HOVER_CARD_SURFACE_CLASS_NAME`). Do not widen it; thread and project cards must stay the same width.

Layout, top to bottom, reusing `SIDEBAR_HOVER_CARD_ROW_CLASS_NAME`:

1. Existing header (folder + name + pin)
2. Existing chat count
3. **New recap block** (omit when empty-zero-chats):
   - Counts: `2 working · 1 waiting · 1 blocked` (only non-zero lanes, `text-foreground/80`)
   - Open PRs: existing `PrStateChip`s, wrap, max 3 + `+N`
   - Last activity: `12m ago` (or `Nothing in progress` when lanes are empty)
   - Headlines: up to 3 buttons, `truncate`, leading muted lane word (`Waiting` / `Blocked` / `Working`) then title. `onOpenThread(threadId)`.
4. Existing divider + path
5. Existing divider + Edit project

Copy:

- Counts use lowercase lane names to match Activity's quiet meta, not Kanban column titles.
- `Nothing in progress` is the only empty-recap sentence.
- No "Recap" section label — the card is already the project glance. Thread recap owns the word Recap in Environment.

Headlines are real buttons (PreviewCard already allows pointer into the popup). Do not navigate PRs from this card in v1; the project row already has a PR toolbar button.

## Performance (non-negotiable)

Hover must be render-only.

**Do**

- Derive `ProjectRecap` inside `deriveSidebarProjectData` in the same per-project pass that already computes `projectStatus`. Collapsed projects already scan `allProjectThreads`; recap is O(threads in that project), already paid.
- Keep `ProjectHoverCardContent` presentational: props in, no hooks, no queries.
- Overlay live PRs only from the existing `prByThreadId` map (visible rows). Never pass a project's full thread list into `useThreadPullRequests`.

**Do not**

- Call `git.status` / `gitStatusQueryOptions` when the pointer enters a project row.
- Call `pullRequests.list` or `git.resolvePullRequest` for recap.
- Call `orchestration.getSnapshot` or any workspace/file index.
- Trigger `server.generateThreadRecap`.
- Subscribe the hover card to `threadShellById` (would pull shells onto the sidebar hover path).
- Copy `ThreadGoal` (max 4096 chars) onto every `SidebarThreadSummary`.

`git.status` is capacity-limited on the server. Sidebar comments already say PR badges are scoped to visible rows because hidden history must stay out of git targets. Recap must not undo that.

## Files

### New

| File | Role |
| --- | --- |
| `apps/web/src/lib/projectRecap.ts` | Pure derivation: eligibility, exclusive lane, PR dedupe/cap, headlines, empty-state flags. No React. |
| `apps/web/src/lib/projectRecap.test.ts` | Lane priority, exclusions, PR dedupe, caps, empty states. |
| `apps/web/src/components/ProjectHoverCardContent.test.tsx` | Presentational: recap block visibility, no-zero-counts, headline buttons, empty copy. Optional if a logic-only test plus a thin render test in the hover card file is enough; prefer a small component test because this is user-facing. |

### Modify

| File | Change |
| --- | --- |
| `apps/web/src/types.ts` | Add to `SidebarThreadSummary`: `goalPausedAt?: string \| null` and `hasGoal?: boolean`. Not the goal string. |
| `apps/web/src/storeProjection.ts` | `buildSidebarThreadSummary` + `sidebarThreadSummariesEqual` copy/compare those two fields from `Thread`. |
| Existing store projection tests | Assert paused-goal / hasGoal survive snapshot → summary and do not churn when unchanged. |
| `apps/web/src/components/Sidebar.logic.ts` | Extend `SidebarDerivedProjectData` with `recap: ProjectRecap`. Compute via `deriveProjectRecap(allProjectThreads)` inside `deriveSidebarProjectData` (both expanded and collapsed branches). |
| `apps/web/src/components/Sidebar.logic.test.ts` | Collapsed project still gets a recap from all threads, not `visibleEntries`. Archived / subagent threads excluded. |
| `apps/web/src/components/ProjectHoverCardContent.tsx` | Render recap block; accept `recap`, `lastActivityLabel`, `onOpenThread`. |
| `apps/web/src/components/Sidebar.tsx` | Pass recap + last activity + `onOpenThread` into `renderProjectHoverCardPopup`. Overlay `prByThreadId` only as an optional live PR hint for threads already in that map — do not fetch. |
| `apps/web/src/whatsNew/entries.ts` | One feature under the current `apps/web/package.json` version: resume a project from the sidebar hover card. |

Fixture updates: any `as SidebarThreadSummary` / `makeSidebarThreadSummary` helpers that must stay exhaustive. Keep new fields optional so most fixtures compile without edits.

### Do not modify

- `apps/web/src/hooks/useThreadRecap.ts`, `apps/web/src/lib/threadRecap.ts`, `server.generateThreadRecap`, TextGeneration recap prompts
- `apps/web/src/components/kanban/**` board math or overview
- `packages/contracts` (no new RPC)
- `apps/server` projection / git / pull-request list
- Environment panel recap section

## Implementation sequence

1. **Pure function + tests** — `deriveProjectRecap(threads): ProjectRecap`. Compose `isThreadActivelyWorking`, `canSessionAnswerPendingRequests`, and the same waiting checks as `resolveThreadStatusPill`. Do not import React or query clients.
2. **Compact goal flags on the sidebar summary** — projection only. `hasGoal = Boolean(thread.goal?.trim())`, `goalPausedAt` as stored.
3. **Sidebar derive** — attach recap to `SidebarDerivedProjectData`.
4. **Hover card UI** — presentational rows; reuse `PrStateChip` and hover-card row classes.
5. **Wire Sidebar** — pass data; headline navigates with the existing thread navigation helper (same as clicking a sidebar row).
6. **WhatsNew** — after the UI exists.

Stop after the hover card is complete. No follow-on panel.

## Tests and verification

Focused (implementation turn):

```text
cd apps/web && bun run test -- src/lib/projectRecap.test.ts src/components/Sidebar.logic.test.ts src/components/ProjectHoverCardContent.test.tsx
```

Plus whatever store-projection test file covers `buildSidebarThreadSummary` once goal flags are added.

Required cases:

- waiting beats working beats blocked
- dead session pending approval is not waiting (mirror kanban / status pill)
- paused goal is blocked only when not waiting/working
- conflicting `lastKnownPr` is blocked when idle
- closed/merged PRs omitted; open PRs deduped; cap 3 + remainder
- parent/archived/automation-run (when hidden) omitted
- collapsed project recap uses full project thread list
- empty: zero chats vs nothing-in-progress
- `ProjectHoverCardContent` has no `useQuery` / `useThreadPullRequests`

Performance regression test: a unit test that `deriveProjectRecap` is a pure function of summaries (no mocks of NativeApi). Do not add a hover-triggered git.status test unless it fails closed.

Browser: after UI exists, hover a project with mixed waiting/working/PR threads and a collapsed empty project. Check desktop sidebar width; card stays `w-[16rem]`. If browser tools are unavailable, say so and rely on the component test.

Do not run `bun fmt` / `bun lint` / `bun typecheck` unless the operator asks. They must pass before the task is complete.

## Out of scope

- Rewriting kanban
- Replacing or sharing the thread recap LLM pipeline
- Cloud sync / multi-device recap cache
- Aggregating Environment notes or project instructions
- Live CI / review-comment rollups (`summarizePullRequestChecks` stays on the Environment PR section)
- New `server.generateProjectRecap` RPC
- Project recap panel, command palette entry, or settings toggle
- Composer drafts on the recap
- Unseen-completion as a fourth lane (Activity already owns that)

## Optional later (not v1)

On-demand LLM project summary, modeled on thread recap:

- Stateless `generateProjectRecap` from already-derived recap facts + optional recent titles
- Client debounce and cache; never on hover
- Explicit user action (button on the card or later panel)

Only if v1 derived recap ships and is not enough.

## Acceptance

A later turn is done when:

1. Hovering any sidebar project shows current working / waiting / blocked counts from in-memory thread summaries.
2. Open linked PRs from `lastKnownPr` appear without a new git/PR fetch.
3. Collapsed projects recap their hidden threads without registering new `git.status` queries.
4. Clicking a headline opens that thread.
5. Thread recap, kanban, and PR list behavior are unchanged.
6. Focused tests above pass.

## Research notes (do not re-litigate)

- `ProjectHoverCardContent` is wired from `Sidebar.tsx` `renderProjectHoverCardPopup`; collapsed folders still compute `allProjectThreadCount` and `projectStatus` from every project thread (`deriveSidebarProjectData`).
- `useThreadPullRequests` documents that hidden history must stay out of git targets. Kanban overview already caps live PR resolution to `overviewVisibleKanbanCards`.
- `OrchestrationThreadShell` already has `goal` + `goalPausedAt`; only the sidebar summary projection drops them.
- Thread recap lives in Environment under `settings.showEnvironmentRecap`. Leave that flag alone.
