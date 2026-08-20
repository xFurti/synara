# Plan 008: Provider Bake-off (two worktrees, one comparison)

> **Executor instructions**: Implement only the smallest v1 described here.
> Reuse thread creation, managed worktrees, split chat, and existing diff
> RPCs. If a STOP condition occurs, stop and report; do not invent a third
> orchestration engine, a 3+ provider fan-out, an automatic winner, or a merge
> of both diffs.
>
> **Drift check (run first)**:
> `git diff --stat HEAD -- packages/contracts/src/orchestration.ts packages/shared/src/composerSlashCommands.ts apps/web/src/composerSlashCommands.ts apps/web/src/lib/sidechatCreation.ts apps/web/src/hooks/useThreadHandoff.ts apps/web/src/splitViewStore.ts apps/web/src/components/DiffPanel.tsx apps/server/src/agentGateway/creationCoordinator.ts apps/web/src/components/ChatView.logic.ts`
> If an in-scope file changed, compare this plan with the live implementation
> before editing.

## Status

- **Priority**: P1
- **Effort**: M
- **Risk**: MEDIUM
- **Depends on**: none (reuses existing thread/worktree/split/diff surfaces)
- **Category**: product / comparison
- **Planned at**: worktree pinned at official synara main `e17505500` (`feat/provider-bakeoff`)

## Why this matters

Synara already has:

| Existing product | What it is | Why it is not a bake-off |
| --- | --- | --- |
| Handoff (`thread.handoff.create`, `useThreadHandoff`) | Sequential: another provider continues the **same** checkout and imported transcript | One owner, one environment. Not a paired experiment. |
| Fork (`thread.fork.create`, `/fork`) | Continue/split this conversation; optional new worktree | Same provider by default; transcript lineage, not a provider A/B test. |
| Side (`/side`, `sidechatSourceThreadId`, right dock) | Guarded clone in a dock pane, optionally another provider | Sequential/adjacent chat, **shares the source environment**. Not two isolated trees. |
| Split chat (`splitViewStore`, `SplitChatSurface`) | Client-persisted 2-pane layout of any two threads | Layout only. No shared objective, no pair identity, no keep/discard. |
| Agent Gateway `synara_create_threads` | Exact batch of 1–20 standalone threads, worktree-isolated, idempotent `requestId` | Agent-initiated independent tasks. No comparison UI, no keep-one, no bake-off identity. |
| Kanban new task | One task, one provider, one env | Worktree preflight is deferred to ChatView (`kanbanDispatch` returns `open-thread` when worktree is pending). |
| Diff panel | Per-thread repo/turn diff (`git.readWorkingTreeDiff`) | One cwd. No cross-worktree comparison. |

The missing product move is: **run this objective on two installed providers, each on its own worktree, then compare the diffs and keep one.**

Handoff is sequential. Split is two unrelated tasks. Bake-off is a paired experiment with a shared prompt and a comparison surface.

## v1 product contract

From a prompt **or** an existing task:

1. Create **exactly two** new sibling worktree tasks.
2. Same objective text. Different providers. Isolated Git worktrees pinned at the same `baseRef`.
3. Open them in an existing **split** (not Side dock).
4. Show a **comparison** of the two working-tree/branch diffs.
5. **Keep this one** archives/discards the other. Do not auto-merge. Do not promote both.

Out of scope for v1 (STOP if tempted):

- More than two providers.
- Automatic winner / scoring.
- Merging both diffs into one branch.
- Routing UI bake-off through Agent Gateway.
- A new orchestration engine, saga, or `thread.bakeoff.create` command type.
- Using `parentThreadId` (subagents), `handoff`, `forkSourceThreadId`, or `sidechatSourceThreadId` as the pair identity.
- Putting the entry point in `ComposerExtrasMenu` (that menu is attachments + mode).
- Changing default `bun run dev` ports or the user's `~/.synara` instance.

## Identity model: two peers, shared bake-off record

**Choose two peer threads, not a parent experiment worker.**

The originating chat (composer prompt or existing task) is a **source**, not a third running arm and not a subagent parent.

```
sourceThreadId?  (origin chat; optional)
        │
        ├── peer A  worktree + provider 1  bakeoff.experimentId = E
        └── peer B  worktree + provider 2  bakeoff.experimentId = E
                    bakeoff.peerThreadId points at the other peer
```

Add a `ThreadBakeoff` struct on each peer, same pattern as `ThreadHandoff` (JSON column, optional on create/meta):

```ts
ThreadBakeoff = {
  experimentId: string,          // shared UUID for the pair
  peerThreadId: ThreadId,        // the other arm
  sourceThreadId: ThreadId | null,
  prompt: string,                // exact shared objective
  baseRef: string,               // Git revision both worktrees were pinned at
  role: "left" | "right",        // stable pane order
  status: "running" | "kept" | "discarded" | "failed",
}
```

Also set `creationSource: "bakeoff"` on both peers (extend `ThreadCreationSource`).

### Why not the other identity fields

| Field | Current meaning | Bake-off use? |
| --- | --- | --- |
| `parentThreadId` | Subagent tree; archive/restore/delete of parent applies to descendants; ChatView subagent strip | **No.** Would mix bake-off arms into subagent UI and lifecycle. |
| `forkSourceThreadId` | Transcript fork lineage | **No.** Bake-off does not import the origin transcript. |
| `sidechatSourceThreadId` | Side dock clone | **No.** Bake-off is a split of two isolated worktrees. |
| `handoff` | Sequential provider continuation of the same cwd | **No.** |
| `gatewayOperationId` | Agent batch provenance | **No** for UI bake-off. Gateway batches remain independent tasks. |
| `sourceThreadId` | Already used for gateway/automation provenance | **Yes, as origin only** when launched from an existing task. |

Keep `parentThreadId: null` on both peers.

## Git isolation

Reuse the first-send worktree path already in ChatView:

- `git.createWorktree` (`packages/contracts/src/git.ts`, `apps/server/src/git/Layers/GitCore.ts`)
- `buildTemporaryWorktreeBranchName()` (`packages/shared/src/git.ts`) → `synara/<8 hex>` unique per arm
- `copyChangesFrom` when `baseRef` is the project checkout HEAD (same as ChatView when `baseBranchForWorktree === activeRootBranch`)
- `runWorktreeCreationFlow` in `apps/web/src/components/ChatView.logic.ts` — extract a **non-interactive** variant (no setup-card Cancel/Work-locally). Bake-off must not leave two setup cards for the user to babysit.

Both arms:

- `envMode: "worktree"`
- Same `baseRef` (active root branch, or the source thread's associated worktree ref if the origin is already on a worktree)
- Distinct `newBranch` and `path`
- Never `envMode: "local"` — a bake-off on the shared checkout would race writes

If the project is not a Git repo or no base branch can be resolved: toast and create nothing.

Compensation: if arm B's worktree fails after arm A succeeded, keep A, mark B `failed`, still open split. If **both** worktrees fail, `git.removeWorktree({ force: true, reclaimTemporaryBranch: true })` any partial path and create no threads (or delete any already-promoted shells). Mirror ChatView's send-failure unwind and gateway compensation, but **do not** call `creationCoordinator.ts`.

## UX entry point: `/bakeoff` slash command

**Slash command, not composer extras.**

`ComposerExtrasMenu` is attachments + Plan/Debug/Fast. Bake-off is a task-creation verb, like `/side` and `/fork`.

### Command

`/bakeoff [provider-a] [provider-b] [prompt]`

Parse in `apps/web/src/composerSlashCommands.ts` next to `parseSideSlashCommandArgs`:

| Input | Meaning |
| --- | --- |
| `/bakeoff` | Current provider vs first eligible other. Objective = composer text, else thread goal, else last user message. |
| `/bakeoff claude` | Current vs Claude. Rest of args optional prompt. |
| `/bakeoff codex claude implement X` | Codex vs Claude, prompt `implement X`. |
| `/bakeoff claude implement X` (current is Codex) | Codex vs Claude, prompt `implement X`. |

Reuse `matchSideProviderToken` / `PROVIDER_DISPLAY_NAMES` / `DEFAULT_PROVIDER_ORDER`. Providers must be distinct, enabled, and `isProviderUsable` after `resolveProviderSendAvailabilityWithRefresh` (same preflight as `useThreadHandoff`).

`canOfferBakeoffSlashCommand`: project is Git-backed, at least one other installed provider is usable, not already a bake-off arm, not a sidechat, not a subagent. **Allow a non-empty composer prompt** (unlike `/fork`/`/side`, which require an empty composer because they operate on the current thread). If the command is invoked with no objective text anywhere, toast and do nothing.

Add `"bakeoff"` to `packages/shared/src/composerSlashCommands.ts` `BUILT_IN_COMPOSER_SLASH_COMMANDS`. Keep it app-owned even for Claude (same reason as `/fork`/`/side`: it creates Synara threads). Map an icon in `apps/web/src/lib/slashCommandIcons.ts` (reuse `GitForkIcon` or `WorktreeIcon`, do not invent a new glyph).

No header-menu duplicate in v1. No Kanban extras item in v1. Existing task path is: open the task, `/bakeoff …`.

## Creation flow (client coordinator, existing commands)

New helper `apps/web/src/lib/threadBakeoff.ts` + hook `apps/web/src/hooks/useThreadBakeoff.ts`.

Do **not** go through `synara_create_threads`. That path is MCP idempotency for agents. UI bake-off is a user gesture.

Sequence:

1. Resolve objective, two `ModelSelection`s (`resolveThreadHandoffModelSelection` for defaults), `baseRef`, project cwd.
2. Preflight both providers. If **neither** is usable, toast and stop. If **one** is unusable/rate-limited, still create the usable arm and a failed/placeholder peer (see failures).
3. Create two worktrees in parallel (`git.createWorktree`). Unique temp branches. Same `baseRef`.
4. `promoteThreadCreate` / `thread.create` twice with `envMode: "worktree"`, worktree path/branch filled in, `creationSource: "bakeoff"`, `bakeoff: {…}`, titles like `{objective preview} · {Provider}`.
5. `thread.turn.start` on each with the **same** user message text (no transcript import). `dispatchMode: "queue"`.
6. `splitViewStore.createFromDrop({ sourceThreadId: peerA, droppedThreadId: peerB, direction: "horizontal", side: "second", ownerProjectId })`.
7. `navigate({ to: "/$threadId", params: { threadId: peerA }, search: () => ({ splitViewId }) })`.

Reuse:

- `promoteThreadCreate` (`apps/web/src/lib/threadCreatePromotion.ts`)
- worktree mutation already used in ChatView (`createWorktreeMutation`)
- `buildPromptThreadTitleFallback` + provider display name
- `newThreadId` / `newCommandId` / `newMessageId`

Do not duplicate ChatView's 800-line send path. Extract only: create worktree without the interactive setup card, then promote + `thread.turn.start` (the kanban dispatch path already does promote + turn.start **once a worktree exists**).

## Split + comparison surface

**Show them split** using `SplitChatSurface`, not the Side dock.

Each split pane already hosts `LazyDiffPanel` (`apps/web/src/components/chat/SplitChatSurface.tsx`). That is necessary but not sufficient.

Add a thin bake-off chrome **on the split only** when both pane threads share `bakeoff.experimentId`:

1. Banner: `{Provider A} vs {Provider B}` + shared objective preview.
2. **Compare diffs** control: open both panes' diff panels (repo scope `workingTree`, fallback `branch`) via existing `setPanePanelState`.
3. A compact **union file list** above or between the two diffs:
   - Fetch `git.readWorkingTreeDiff({ cwd: worktreePath, scope: "workingTree" })` per arm (existing query in `apps/web/src/lib/gitReactQuery.ts`).
   - Classify paths: A only / B only / both.
   - Clicking a path sets that file in both pane diff views when present (`diffFilePath` already lives on `SplitViewPanePanelState`).
4. Per-pane **Keep this one** in the bake-off banner (not a new Git merge button).

Do **not** add a new git RPC. Do **not** `git diff` tree A vs tree B as a synthetic merge. The comparison is two independent diffs against the shared `baseRef`.

New UI files (keep small):

- `apps/web/src/components/chat/BakeoffSplitBanner.tsx`
- `apps/web/src/components/chat/BakeoffDiffCompare.tsx` (union list + dual-open)
- `apps/web/src/lib/bakeoffDiffCompare.ts` (pure path classification)

Wire the banner from `SplitChatSurface`. Do not special-case `ChatView.tsx` beyond slash dispatch.

## Keep this one

Winner stays a normal worktree task. Loser is discarded, not merged.

`keepBakeoffPeer(winnerThreadId)` in `apps/web/src/lib/threadBakeoff.ts`:

1. Confirm: `Keep {Provider}? The other worktree will be archived and removed.`
2. If loser latest turn is running: `orchestration.interrupt` (existing NativeApi) then proceed.
3. `thread.meta.update` winner `bakeoff.status = "kept"`; loser `discarded`.
4. `archiveThreadFromClient` loser (`apps/web/src/lib/threadArchive.ts`).
5. `git.removeWorktree({ cwd: project.cwd, path: loser.worktreePath, force: true, reclaimTemporaryBranch: true })` — same as delete/cancel paths in ChatView and sidebar.
6. Collapse split: `removePaneFromSplitView` for the loser, then `navigate` to winner without `splitViewId` (reuse `resolveSplitPaneCloseDecision` / `resolveSplitPaneMaximizeDecision` in `apps/web/src/routes/-chatThreadRoute.logic.ts`).
7. Toast: `Kept {Provider}. {Other} archived.`

Do **not** auto-commit, push, or open a PR. The winner is just the surviving task.

Archived managed worktrees are already retained then reclaimed (`apps/server/src/managedWorktrees.ts`). Explicit `removeWorktree` on keep is still required so the discarded experiment does not linger as a live checkout.

Source thread (if any) is unchanged: not archived, not converted into the winner.

## Failure cases

| Case | Behavior |
| --- | --- |
| Neither provider installed/enabled | Toast. Create nothing. |
| One provider unavailable at preflight | Create the usable arm + a failed peer shell **without** a worktree (or skip the failed peer and still split against a placeholder empty pane). Toast names the missing provider. Compare/Keep still work on the live arm. |
| One provider rate-limited at preflight (`account.rate-limited` / unusable status) | Same as unavailable. Do **not** auto-retry. User can later start a replacement from that pane's composer, or Keep the healthy arm. |
| Worktree create fails for one arm | Compensate that path. Promote/start only the successful arm. Mark the other `failed`. |
| Worktree create fails for both | Remove any partial worktrees. No `thread.create`. Toast. |
| `thread.create` / `turn.start` fails for one after worktrees exist | Leave that worktree attached to the failed thread (or remove it if the thread never landed). Other arm continues. |
| One arm errors mid-turn | Pair stays `running`. Comparison still shows whatever diffs exist. Keep remains user-driven. |
| User archives one arm from the sidebar | Treat as discard: update peer `bakeoff.status`, collapse split if this experiment's split is open. |
| Reconnect / refresh | Pair identity is durable on the thread projection. Split layout is client-persisted (`synara:split-view-state:v1`). Re-open comparison from bake-off metadata if the split is gone: offer "Compare bake-off" on either peer's header that recreates the split. v1 can be: if split missing, banner on a single peer with "Open other pane". |
| Origin thread deleted | Peers remain; `sourceThreadId` may dangle. Lookup must tolerate a missing source. |

Do **not** fail-closed the whole experiment because one provider is rate-limited. The point of a bake-off is still getting one implementation.

## Exact files

### Contracts + projection (durable identity)

- `packages/contracts/src/orchestration.ts` — `ThreadBakeoff`, extend `ThreadCreationSource` with `"bakeoff"`, optional `bakeoff` on `OrchestrationThread` / `OrchestrationThreadShell` / `thread.create` / `thread.meta.update` / `thread.created` payload.
- `packages/contracts/src/orchestration.test.ts`
- `apps/server/src/orchestration/decider.ts` — pass `bakeoff` through `thread.create` / `thread.meta.update` like `handoff`.
- `apps/server/src/persistence/Migrations/097_ProjectionThreadsBakeoff.ts` — `ALTER TABLE projection_threads ADD COLUMN bakeoff_json TEXT` (same style as `017_ThreadHandoffMetadata.ts`).
- `apps/server/src/persistence/Services/ProjectionThreads.ts`
- `apps/server/src/persistence/Layers/ProjectionThreads.ts`
- `apps/server/src/persistence/Migrations.ts` — register 097.
- `apps/web/src/types.ts`, `apps/web/src/storeNormalization.ts`, `apps/web/src/storeEventReducer.ts` — project `bakeoff` onto client threads.

No new command type. No new WS method. No new git RPC.

### Shared + slash

- `packages/shared/src/composerSlashCommands.ts`
- `apps/web/src/composerSlashCommands.ts` + `.test.ts`
- `apps/web/src/lib/slashCommandIcons.ts`
- `apps/web/src/hooks/useComposerSlashCommands.ts`
- `apps/web/src/hooks/useComposerCommandMenuItems.ts` (if command availability is listed there)

### Bake-off coordinator + UI

- `apps/web/src/lib/threadBakeoff.ts` + `.test.ts` — parse args, resolve providers, titles, keep/discard, path classification helpers may live in `bakeoffDiffCompare.ts`.
- `apps/web/src/hooks/useThreadBakeoff.ts`
- `apps/web/src/components/chat/BakeoffSplitBanner.tsx`
- `apps/web/src/components/chat/BakeoffDiffCompare.tsx`
- `apps/web/src/lib/bakeoffDiffCompare.ts` + `.test.ts`
- `apps/web/src/components/chat/SplitChatSurface.tsx` — mount banner when pair detected.
- Optionally `apps/web/src/components/ChatView.logic.ts` — extract non-interactive worktree create from `runWorktreeCreationFlow` if the interactive race is in the way. Prefer a sibling `createManagedWorktreeForThread` rather than expanding ChatView.

### Reuse, do not rewrite

- `apps/web/src/splitViewStore.ts` / `splitView.logic.ts`
- `apps/web/src/components/DiffPanel*.tsx` / `DiffPanel.logic.ts`
- `apps/web/src/lib/gitReactQuery.ts` (`git.readWorkingTreeDiff`, `gitRemoveWorktreeMutationOptions`)
- `apps/web/src/lib/threadArchive.ts`
- `apps/web/src/lib/threadCreatePromotion.ts`
- `apps/web/src/lib/threadHandoff.ts` (`resolveThreadHandoffModelSelection`, availability helpers)
- `apps/web/src/lib/providerAvailability.ts`
- `apps/web/src/lib/kanbanDispatch.ts` — only after worktrees exist
- `apps/server/src/git/Layers/GitCore.ts` `createWorktree` / `removeWorktree`
- `apps/server/src/managedWorktrees.ts`

### Do not touch (STOP)

- `apps/server/src/agentGateway/creationCoordinator.ts` and MCP catalog
- `thread.handoff.create` / Side dock / `parentThreadId` subagent strip
- `ComposerExtrasMenu.tsx` / `KanbanTaskExtrasMenu.tsx`
- Git stacked actions, commit/PR, merge

## Tests

Focused tests only. Never `bun test`; use `bun run test` on named files.

### Parser / identity

- `apps/web/src/composerSlashCommands.test.ts` — `/bakeoff` provider tokens, current-vs-other, prompt remainder, unavailable provider.
- `apps/web/src/lib/threadBakeoff.test.ts` — pair lookup by `experimentId`, keep updates statuses, missing source tolerated, two providers must differ.

### Diff compare

- `apps/web/src/lib/bakeoffDiffCompare.test.ts` — A-only / B-only / both path sets from two `FileDiffMetadata` lists.

### Orchestration / projection

- Decider: `thread.create` with `bakeoff` round-trips; `thread.meta.update` can set `kept`/`discarded`; `parentThreadId` stays null; `creationSource` is `bakeoff`.
- Projection layer: `bakeoff_json` encode/decode (null-safe for old rows).

### UI / hook

- Split banner renders only when both leaves share `experimentId`.
- Keep calls archive + removeWorktree + split collapse (mock NativeApi).
- Preflight: one provider unusable → one started arm, toast, no throw of the whole pair.

### STOP if a test wants

- A fake 3-provider matrix.
- A scoring/winner heuristic.
- `git merge` / patch application of the discarded tree.
- Gateway `requestId` replay for UI bake-off.

## Verification

After implementation, one combined pass:

```
bun fmt
bun lint
bun typecheck
```

Plus focused `bun run test` on the files above.

Browser: isolated Synara instance per `.claude/skills/verify/SKILL.md` (do not reuse the user's default ports). Exercise:

1. `/bakeoff` from a Git project composer with a prompt → two worktrees, split opens, both turns start.
2. Open compare → both diff panes + union list.
3. Keep one → other archived, its worktree gone, split collapses, winner still editable.
4. `/bakeoff` when one target is disabled → usable arm still runs.
5. Regression: `/side`, `/fork`, header handoff, and ordinary worktree first-send still work.

## Implementation order

1. Contracts + migration 097 + decider/projection + client store fields.
2. Slash parse + menu availability.
3. Worktree pair create + `thread.create` + `turn.start` + split navigate.
4. Bake-off banner + dual diff compare.
5. Keep/discard.
6. Failure toasts + partial pair.
7. Tests + fmt/lint/typecheck + isolated browser pass.

## STOP conditions

Stop and report instead of improvising if:

- Implementation starts adding `thread.bakeoff.create` or a server saga.
- UI bake-off is wired through `synara_create_threads` / `creationCoordinator`.
- `parentThreadId`, handoff, fork, or sidechat is reused as pair identity.
- A third provider, auto-winner, or merge of both diffs is requested as part of this v1.
- Worktrees are created on `envMode: "local"`.
- Diff compare needs a new git RPC rather than two `readWorkingTreeDiff` calls.
- ChatView send path is copied wholesale instead of extracting a small worktree+promote+start helper.

## Current-state evidence (this worktree)

- Thread create/fork/handoff commands: `packages/contracts/src/orchestration.ts` (`thread.create` ~1093, `thread.handoff.create` ~1148, `thread.fork.create` ~1174, `thread.archive` ~1207).
- Subagent parent walk: `packages/shared/src/threadHierarchy.ts`.
- Slash `/side` `/fork`: `apps/web/src/composerSlashCommands.ts`, `apps/web/src/hooks/useComposerSlashCommands.ts`.
- Side creation: `apps/web/src/lib/sidechatCreation.ts` (opens right dock `kind: "sidechat"`).
- Handoff: `apps/web/src/hooks/useThreadHandoff.ts` (same cwd, imported messages, navigate to **one** new thread).
- Split: `apps/web/src/splitViewStore.ts`, route `apps/web/src/routes/_chat.$threadId.tsx` → `SplitChatSurface`.
- First-send worktree: `apps/web/src/components/ChatView.tsx` ~8001–8326 + `runWorktreeCreationFlow`.
- Kanban will not create worktrees: `apps/web/src/lib/kanbanDispatch.ts` ~164–165.
- Gateway batch: `packages/contracts/src/agentGateway.ts`, `apps/server/src/agentGateway/creationCoordinator.ts`.
- Diff: `GitReadWorkingTreeDiffInput` in `packages/contracts/src/git.ts`; panel is per-thread.
- Archive: `apps/web/src/lib/threadArchive.ts`; managed worktree retention: `apps/server/src/managedWorktrees.ts`.
- Latest projection migration at plan time: `096_ProjectionThreadsGoalAchievements.ts`.
