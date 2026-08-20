# 008 — Copy task link + task templates

Status: TODO
Priority: P2
Effort: M
Depends on: —
Branch: `feat/task-link-templates` (pinned at official synara main `e17505500`)

This is a research-backed implementation plan, not an implementation. One PR. Do not mix cloud sharing, Linear/GitHub import, onboarding, or a template marketplace.

## Why one PR

Copy-link and templates do **not** share the new-task entry. They do share task identity UX, clipboard/toast helpers, command-palette actions, and keybinding registration.

Keep them in one PR because both slices are small and the branch is already named for both. Split only if review load becomes the blocker.

## Current machinery (do not reinvent)

| Surface | What exists | Gap |
| --- | --- | --- |
| `thread.copyId` | Copies the raw UUID. Chord `mod+shift+c`. Handler in `ChatView`. Context menus: sidebar, activity, kanban. Toast via `useCopyThreadIdToClipboard`. | Not a URL. Cannot reopen the task in the app. |
| Route | `/_chat/$threadId` → public path `/$threadId`. Web uses browser history (`http://host:port/<uuid>`). Desktop uses hash history (`synara://app/index.html#/<uuid>`). | No copy-link builder. Desktop does **not** register as a protocol client and `second-instance` only focuses the window. |
| Missing thread | `_chat.$threadId.tsx` waits, then `navigate({ to: "/", replace: true })`. Silent. | Opening a foreign/stale link dumps the user on Home with no explanation. |
| New task | `useHandleNewThread` + `NewThreadOptions` (`provider`, `envMode`, `fresh`, branch/worktree). Palette actions `new-thread` / `new-chat`. Chords `chat.new`, `chat.newLatestProject`, `chat.newChat`/`chat.newLocal`, `chat.newTerminal`, `chat.newClaude`/`chat.newCodex`/`chat.newCursor`. Project-row `+` is a single button, no menu. | No presets. |
| Composer apply points | `setModelSelection`, `setPrompt`, `setInteractionMode`, `setRuntimeMode`, `setDraftThreadContext({ goal, envMode, ... })`. Goal is staged on the draft and persisted on first send. | Need a single apply-template helper. |
| Traits | `composerTraits.ts` resolves effort/fast/thinking from the selected model. Templates must not invent provider option keys; they set provider (+ optional model) and let traits resolve. | — |
| Project instructions | Environment panel, per-project notes. Different product. | Do not reuse as templates. |
| Settings | `AppSettings` in `localStorage` key `synara:app-settings:v1`. General already has Default provider + New threads (local vs worktree). | Add a Task templates row/section here. |
| Slash `/review` | Built-in prompt helper, not a reusable user preset. | Leave it alone. |
| Kanban new-task dialog | Separate composer with provider/mode/env. | Out of scope for v1. |

---

## A. Copy task link

### Product

Copy a URL that opens **this task in this local Synara instance**. Keep Copy Thread ID as a power-user action (MCP, logs). Make Copy link the user-facing Codex-like action.

**Default chord:** move `mod+shift+c` from `thread.copyId` to `thread.copyLink`. Codex muscle memory. Keep Copy Thread ID in context menus, unbound by default.

### What the URL is

Build from the running origin. Do not invent a cloud host.

| Runtime | Copied URL | How it opens |
| --- | --- | --- |
| Web / remote HTTP | `{origin}/{threadId}` e.g. `http://127.0.0.1:3773/<uuid>` | Same origin, existing SPA route. |
| Desktop | `{origin}/index.html#/{threadId}` e.g. `synara://app/index.html#/<uuid>` | Hash history. Must also handle OS open so the click focuses this app and navigates. |

Helper (new): `apps/web/src/lib/threadLink.ts`

```ts
export function buildThreadLink(
  threadId: string,
  input: { origin: string; isElectron: boolean },
): string
export function parseThreadIdFromAppUrl(url: string): string | null
```

Rules:

- Thread ids are UUIDs from `newThreadId()` (`ThreadId.makeUnsafe(randomUUID())`).
- Do not put auth tokens, home dir, or query junk in the link.
- Do not copy split-view / diff search params. The link is the thread, not the chrome.
- Sidebar/kanban can copy a link without being on the thread route — never use `window.location.href` as the only source.

### Honest local-first limits (document in toast + shortcuts sheet)

A copied link is **not** shareable the way a Codex/ChatGPT task URL is.

It will not work when:

- The other machine does not have this SQLite home dir (thread ids are local).
- Desktop `synara://` is opened on a different install / canary flavor (`synara-canary://`).
- Web localhost/LAN URL is opened while a different `--home-dir`, port, or auth token is serving.
- The thread was deleted or never existed here. Current route recovery then redirects Home.

It **will** work when:

- Pasted into the same running web origin.
- Opened on another device hitting the **same** remote Synara server + same home dir (`REMOTE.md`).
- Clicked on this machine after desktop protocol handling (below).

Toast on success: title `Link copied`, description = the URL (same pattern as path/thread-id toasts). Do not claim “shareable”.

Missing-thread open: after the existing recovery delay, if the thread still does not exist, toast `This task is not on this Synara` then keep the Home redirect. One toast, no new empty-state page.

### Desktop open (required for “opens in this local app”)

Today `apps/desktop/src/main.ts` never calls `setAsDefaultProtocolClient`, and `second-instance` only focuses. Without this, a copied `synara://` link cannot navigate.

Minimal handling:

1. `app.setAsDefaultProtocolClient(DESKTOP_SCHEME)` (and canary scheme for canary builds).
2. macOS `open-url`; Windows/Linux `second-instance` argv.
3. Parse with `parseThreadIdFromAppUrl`. Ignore non-thread URLs (settings, assets).
4. IPC the renderer: navigate to `/$threadId` (hash history will produce `#/<id>`).
5. Focus the existing window. Do not spawn a second app.

Keep this tiny. No new custom scheme. Reuse `synara://` / `synara-canary://` already defined in `packages/shared/src/desktopIdentity.ts`.

### UI

1. **Header** — `ChatHeader.tsx`: overflow/title-adjacent menu item `Copy link` (icon + label). Compact header: icon button with tooltip. Hidden in `minimalChrome` empty drafts.
2. **Command palette** — `Sidebar.tsx` `searchPaletteActions`: `{ id: "copy-task-link", label: "Copy task link", ... }` enabled only when a thread is focused. Wire in `SidebarSearchPalette.tsx` `actionHandler`.
3. **Context menus** — add `Copy link` above existing `Copy Thread ID` in:
   - `Sidebar.tsx` thread menu
   - `SidebarActivityView.tsx` (uses the same menu)
   - `useKanbanCardContextMenu.tsx` for thread-backed cards
4. **Shortcut sheet / KEYBINDINGS.md** — new command `thread.copyLink`. Relabel `thread.copyId` as “Copy thread ID (not a URL)”.

### Files

- `apps/web/src/lib/threadLink.ts` + `threadLink.test.ts` (new)
- `apps/web/src/hooks/useCopyToClipboard.ts` — `useCopyThreadLinkToClipboard()`
- `packages/contracts/src/keybindings.ts` — add `"thread.copyLink"`
- `apps/server/src/keybindings.ts` — default `{ key: "mod+shift+c", command: "thread.copyLink", when: "!terminalFocus || isMac" }`; drop that default from `thread.copyId`
- `apps/web/src/keybindings.ts` + `keybindings.test.ts` + `shortcutsSheet.ts` + `KEYBINDINGS.md`
- `apps/web/src/components/ChatView.tsx` — handle `thread.copyLink`
- `apps/web/src/components/chat/ChatHeader.tsx`
- `apps/web/src/components/Sidebar.tsx`, `SidebarSearchPalette.tsx`, `kanban/useKanbanCardContextMenu.tsx`
- `apps/web/src/routes/_chat.$threadId.tsx` — missing-thread toast (extract a tiny helper so it is testable)
- `apps/desktop/src/main.ts` (+ a focused test if there is an existing protocol-parse unit file; otherwise a small `desktopDeepLink.ts` helper with tests)

---

## B. Task templates

### Product

A small **user-editable** list of new-task presets. Applied only when the user picks a template. `Cmd+N` / project `+` stay the current fast path (latest project, default provider, default env mode). Not a marketplace. Not onboarding.

### Fields a template may set

| Field | Maps to | Notes |
| --- | --- | --- |
| `name` | UI label | Required, 1–40 chars |
| `provider` | `NewThreadOptions.provider` + `setModelSelection` | Optional. Omit = current default provider. Do not store model slugs in v1 (they rot). |
| `interactionMode` | `setInteractionMode` / draft `interactionMode` | Optional: `default` \| `plan` \| `debug`. This is “mode”. |
| `envMode` | `NewThreadOptions.envMode` | Optional: `local` \| `worktree`. “worktree” means *new worktree*, same as Settings → New threads. |
| `goal` | `setDraftThreadContext({ goal })` | Optional, cap `THREAD_GOAL_MAX_CHARS` |
| `prompt` | `setPrompt` | Prompt skeleton. May be empty. |

Do **not** store cwd, branch name, absolute worktree path, or project id. Those belong to the project the user is creating in. Do not store composer traits (effort/fast); they follow the provider/model.

### Persistence

Store on **`AppSettings`** (`synara:app-settings:v1`) next to Default provider / New threads.

Schema in `apps/web/src/appSettings.ts`:

```ts
TaskTemplate = {
  id: TrimmedNonEmptyString (max 24, slug-safe)
  name: TrimmedNonEmptyString (max 40)
  provider?: ProviderKind
  interactionMode?: ProviderInteractionMode
  envMode?: "local" | "worktree"
  goal?: string (max THREAD_GOAL_MAX_CHARS)
  prompt: string (max 8_192)
}

taskTemplates: Array<TaskTemplate> (max 20), default = BUILT_IN_TASK_TEMPLATES
```

Seed three built-ins (ids stable so user edits are updates, not duplicates on upgrade):

1. **Bugfix** (`bugfix`) — `envMode: "worktree"`, `interactionMode: "default"`, prompt skeleton asking for repro / expected / fix.
2. **Review** (`review`) — `interactionMode: "plan"`, prompt skeleton for a diff review (do not call `/review`; that slash command is a different path).
3. **Spike** (`spike`) — `envMode: "worktree"`, `interactionMode: "plan"`, prompt skeleton for a time-boxed investigation.

If the user deletes all templates, persist `[]`. Do not resurrect built-ins on decode. Only the first-run empty object gets the seed via `withDecodingDefault`.

LocalStorage does not sync across desktop + a browser tab on a different origin. That matches other UI prefs. Do not put this on `ServerSettings` in v1 (avoids server schema + migration).

### Apply path

New helper: `apps/web/src/lib/applyTaskTemplate.ts`

```ts
applyTaskTemplate(threadId, template, store): void
```

Calls, in order: `setModelSelection` (if provider), `setInteractionMode` (if set), `setDraftThreadContext` (envMode + goal), `setPrompt`.

New-task wrapper used by UI:

```ts
await handleNewThread(projectId, {
  fresh: true,                 // do not reuse a dirty project draft
  provider: template.provider,
  envMode: template.envMode ?? resolveSidebarNewThreadEnvMode({ defaultEnvMode }),
})
// then applyTaskTemplate on the returned thread id
```

`fresh: true` is mandatory so a template cannot clobber an in-progress draft for that project.

Extend `NewThreadOptions` only if it stays cleaner than post-create store calls. Prefer post-create apply so ChatView’s composer sees the prompt on the same draft the route just mounted. `createFreshDraftThreadSeed` does not currently take `interactionMode` or `goal`; either extend the seed **or** apply via `setDraftThreadContext` immediately after create. Prefer the latter to keep bootstrap small.

### UI

1. **Settings → General** (`_chat.settings.tsx`), new section **Task templates** under Core defaults.
   - List of templates: name, summary chips (provider / Local|Worktree / Plan).
   - Add / rename / edit fields / delete / reorder.
   - Use existing `SettingsRow` / `SettingsSection` primitives. Any expand/collapse **must** use `disclosureMotion` / `DisclosureRegion` / `CollapsiblePanel`.
   - Index the section in `settingsSearchIndex.ts` and `settingsNavigation.ts` (no new nav id; stay on `general`).
2. **New-task menu** — project-row `+` stays a click = current `handleNewThread`. Add a sibling chevron (or convert to `ChatHeaderSplitGroup`-style split button) that opens `ComposerPickerMenuPopup` with the template list + “Manage templates…” → `/settings?section=general&target=task-templates`.
   - Global new-thread control in the sidebar header: same menu.
   - Do not add a chord per template.
3. **Command palette** — one action per template: `New thread: Bugfix`. `run` applies to `primaryNewThreadTarget`. If there is no project, keep today’s add-project fallback.
4. **Empty draft landing (optional, cheap)** — if `minimalChrome` and templates.length > 0, a quiet “Start from template” menu on the composer. Skip if it fights the centered empty landing. Settings + palette + new-task menu are enough for v1.

Kanban new-task dialog: **out of scope**.

### Files

- `apps/web/src/lib/taskTemplates.ts` + `taskTemplates.test.ts` — seed, caps, apply, summary chips
- `apps/web/src/lib/applyTaskTemplate.ts` (or fold into `taskTemplates.ts`)
- `apps/web/src/appSettings.ts` — schema + default
- `apps/web/src/routes/_chat.settings.tsx` — editor UI
- `apps/web/src/settingsSearchIndex.ts`
- `apps/web/src/components/Sidebar.tsx` — new-task menu + palette actions
- `apps/web/src/components/SidebarSearchPalette.tsx` / `.logic.ts` — matching
- `apps/web/src/hooks/useHandleNewThread.ts` — only if options need extending
- `apps/web/src/whatsNew/entries.ts` — one feature blurb when the version ships
- `apps/web/src/components/settings/TaskTemplatesSettings.tsx` if the settings route is already too large (likely yes)

---

## Tests

Unit (prefer these; they are cheap and stable):

- `threadLink.test.ts` — web path vs electron hash; ignore search params; parse both URL shapes; reject settings/asset URLs.
- `keybindings.test.ts` — `mod+shift+c` → `thread.copyLink`; macOS terminal still fires; Linux/Windows terminal yields to shell copy; `thread.copyId` no longer default-bound.
- `taskTemplates.test.ts` — decode defaults; cap 20; apply writes prompt/provider/mode/goal/envMode; omit-optional leaves defaults; deleting all persists empty.
- `appSettings` decode: old blobs without `taskTemplates` get the three seeds; blobs with `taskTemplates: []` stay empty.
- Sidebar palette matching: “bugfix” / “copy link” rank the new actions.
- Missing-thread helper: toast+home only after recovery `done`.

Browser / component (narrow):

- `ChatView.browser.tsx` — `thread.copyLink` copies a URL containing the active thread id (mock clipboard).
- Settings General — add/edit/delete a template (if a settings browser test already mounts General; otherwise unit-test the editor helpers).
- Sidebar new-thread menu — picking a template calls handleNewThread with `fresh: true` (logic test with a stub, not a full Sidebar mount unless one already exists).

Desktop:

- Protocol URL parse + “navigate to thread” payload. Do not add an Electron e2e unless one already covers protocol.

Do **not** run `bun test`. Use `bun run test` for the focused files. One final `bun fmt && bun lint && bun typecheck` pass at the end of implementation (not this research turn).

## Out of scope

- Cloud / account sharing
- Linear or GitHub issue import
- Template marketplace or sync
- Rewriting onboarding
- Per-template model slugs, skills, MCP, attachments
- Kanban dialog templates
- Changing `/review`, project instructions, or composer traits
- Putting the auth token in the URL
- Auto-applying a template on every `chat.new`

## Implementation order for the executing turn

1. `threadLink` helper + tests + `useCopyThreadLinkToClipboard`.
2. Keybinding + ChatView + header + context menus + palette.
3. Desktop protocol client + second-instance / open-url navigate.
4. Missing-thread toast.
5. Template schema + seed + apply helper + tests.
6. Settings editor.
7. New-task menu + palette actions.
8. WhatsNew blurb, KEYBINDINGS.md, shortcuts sheet.
9. Focused tests, then one fmt/lint/typecheck pass.

## Done when

- From an open task, Copy link / `mod+shift+c` copies a URL that, in this same app, opens that thread.
- Copy Thread ID still exists in context menus and copies the raw UUID.
- Opening a link for an unknown thread lands on Home with one explanatory toast.
- Settings → General can add/edit/delete up to 20 templates.
- Picking a template from the new-task menu or palette creates a **fresh** draft with that provider/mode/env/goal/prompt.
- `Cmd+N` is unchanged.
- No marketplace, no cloud, no issue import.
