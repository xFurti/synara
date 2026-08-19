// FILE: ThreadHoverCardContent.tsx
// Purpose: Rich hover-card body shown when hovering a sidebar thread/chat row —
//          the title with a relative time on the header line, then project,
//          source folder, git branch, worktree identity, and the chat's current
//          model rows when available.
// Layer: Sidebar UI component
// Exports: ThreadHoverCardContent
// Why: Shared by both the pinned and the nested thread-row tooltips so the two
//      surfaces cannot drift apart.

import type { ReactNode } from "react";

import {
  FastModeIcon,
  GitBranchIcon,
  type LucideIcon,
  WorktreeIcon,
} from "~/lib/icons";
import { cn } from "~/lib/utils";
import type { ThreadModelSummary } from "~/lib/threadModelSummary";
import { FolderClosed } from "./FolderClosed";
import { ProjectSidebarIcon } from "./ProjectSidebarIcon";
import { ProviderIcon } from "./ProviderIcon";
import type { ThreadStatusPill } from "./Sidebar.logic";
import { SidebarStatusTrailingGlyph } from "./SidebarStatusTrailingGlyph";
import {
  SIDEBAR_HOVER_CARD_CONTAINER_PADDING_CLASS_NAME,
  SIDEBAR_HOVER_CARD_ROW_CLASS_NAME,
} from "./sidebarHoverCardStyles";

export type ThreadHoverCardBranchChild = {
  id: string;
  title: string;
  /** Pre-formatted relative time (e.g. "2h"); omitted when unavailable. */
  timeLabel: string | null;
  prColorClass: string | null;
  /** GitHub-style PR state glyph (open/merged/closed/draft/conflicts). */
  prIcon: LucideIcon | null;
  prUrl: string | null;
  /** Actionable live status for the child thread, when one exists. */
  status: ThreadStatusPill | null;
};

export type ThreadHoverCardContentProps = {
  title: string;
  /** Pre-formatted relative time (e.g. "2h"); omitted when unavailable. */
  timeLabel: string | null;
  projectName: string | null;
  /** Project cwd, used to render the matching folder/favicon glyph. */
  projectCwd: string | null;
  /** Underlying project folder/repo name, shown for worktree-backed chats. */
  sourceProjectName: string | null;
  branch: string | null;
  /** Last path segment of the associated worktree path. */
  worktreeName: string | null;
  /** Provider/model/effort currently selected for this chat. */
  model: ThreadModelSummary | null;
  /** Current live/actionable state, shown as text so compact row glyphs stay discoverable. */
  status: ThreadStatusPill | null;
  /** Branch threads nested under this folder row; rendered as a compact list. */
  branchChildren?: readonly ThreadHoverCardBranchChild[] | undefined;
  onOpenPr?: ((url: string) => void) | undefined;
  onOpenBranch?: ((threadId: string) => void) | undefined;
};

const META_ROW_CLASS_NAME = `${SIDEBAR_HOVER_CARD_ROW_CLASS_NAME} text-foreground/80`;
const META_ICON_CLASS_NAME = "size-3.5 shrink-0 text-muted-foreground/75";

function MetaRow({ icon, children }: { icon: ReactNode; children: string }) {
  return (
    <span className={META_ROW_CLASS_NAME}>
      {icon}
      <span className="min-w-0 truncate">{children}</span>
    </span>
  );
}

// Model row: provider glyph, model name, then the reasoning/effort label so the
// line reads like the composer's model trigger.
function ModelRow({ model }: { model: ThreadModelSummary }) {
  return (
    <span className={META_ROW_CLASS_NAME}>
      <ProviderIcon provider={model.provider} className={META_ICON_CLASS_NAME} />
      <span className="min-w-0 truncate">{model.modelLabel}</span>
      {model.fastMode ? (
        <FastModeIcon aria-hidden className="size-3.5 shrink-0 text-muted-foreground/75" />
      ) : null}
      {model.statusLabel ? (
        <span className="shrink-0 text-muted-foreground/70">{model.statusLabel}</span>
      ) : null}
    </span>
  );
}

export function ThreadHoverCardContent({
  title,
  timeLabel,
  projectName,
  projectCwd,
  sourceProjectName,
  branch,
  worktreeName,
  model,
  status,
  branchChildren,
  onOpenPr,
  onOpenBranch,
}: ThreadHoverCardContentProps) {
  const hasMeta =
    Boolean(projectName) ||
    Boolean(sourceProjectName) ||
    Boolean(branch) ||
    Boolean(worktreeName) ||
    Boolean(model) ||
    Boolean(status);
  const branchChildCount = branchChildren?.length ?? 0;

  return (
    <div
      className={`flex w-full flex-col gap-0 ${SIDEBAR_HOVER_CARD_CONTAINER_PADDING_CLASS_NAME}`}
    >
      <div className={SIDEBAR_HOVER_CARD_ROW_CLASS_NAME}>
        <span className="min-w-0 flex-1 whitespace-normal font-medium leading-tight text-foreground">
          {title}
        </span>
        {timeLabel ? (
          <span className="shrink-0 text-[10px] tabular-nums text-muted-foreground/55">
            {timeLabel}
          </span>
        ) : null}
      </div>
      {hasMeta ? (
        <div className="flex flex-col gap-0">
          {status ? (
            <MetaRow
              icon={
                <span
                  aria-hidden="true"
                  className="inline-flex size-3.5 items-center justify-center"
                >
                  <SidebarStatusTrailingGlyph status={status} />
                </span>
              }
            >
              {status.label}
            </MetaRow>
          ) : null}
          {projectName ? (
            <MetaRow
              icon={
                projectCwd ? (
                  <span className="relative inline-flex size-3.5 shrink-0 items-center justify-center text-muted-foreground/75">
                    <ProjectSidebarIcon
                      cwd={projectCwd}
                      expanded={false}
                      glyphClassName="size-3.5"
                    />
                  </span>
                ) : (
                  <FolderClosed className={META_ICON_CLASS_NAME} aria-hidden />
                )
              }
            >
              {projectName}
            </MetaRow>
          ) : null}
          {sourceProjectName ? (
            <MetaRow icon={<FolderClosed className={META_ICON_CLASS_NAME} aria-hidden />}>
              {sourceProjectName}
            </MetaRow>
          ) : null}
          {branch ? (
            <MetaRow icon={<GitBranchIcon className={META_ICON_CLASS_NAME} aria-hidden />}>
              {branch}
            </MetaRow>
          ) : null}
          {worktreeName ? (
            <MetaRow icon={<WorktreeIcon className={META_ICON_CLASS_NAME} aria-hidden />}>
              {worktreeName}
            </MetaRow>
          ) : null}
          {model ? <ModelRow model={model} /> : null}
        </div>
      ) : null}
      {branchChildCount > 0 ? (
        <div className="flex flex-col gap-0 border-t border-border/60 pt-1.5">
          <div className="flex items-center gap-2 px-1">
            <span className="text-[10px] font-medium text-muted-foreground/70">
              {branchChildCount} {branchChildCount === 1 ? "branch" : "branches"}
            </span>
          </div>
          <div className="ml-1 border-l border-border/45 pl-1">
            {branchChildren?.map((child) => {
              const PrIcon = child.prIcon;
              return (
                <div
                  key={child.id}
                  className={cn(META_ROW_CLASS_NAME, "min-h-6 text-foreground/70")}
                >
                {PrIcon && child.prUrl && onOpenPr ? (
                  <button
                    type="button"
                    aria-label={`Open PR for ${child.title}`}
                    title="Open PR"
                    className="inline-flex size-5 shrink-0 cursor-pointer items-center justify-center rounded-sm outline-hidden transition-colors hover:bg-muted focus-visible:ring-1 focus-visible:ring-ring"
                    onClick={(event) => {
                      event.preventDefault();
                      event.stopPropagation();
                      onOpenPr(child.prUrl!);
                    }}
                  >
                    <PrIcon className={cn("size-3.5", child.prColorClass)} aria-hidden />
                  </button>
                ) : (
                  <span
                    aria-hidden="true"
                    className="inline-flex size-3.5 shrink-0 items-center justify-center"
                  >
                    {PrIcon ? (
                      <PrIcon className={cn("size-3.5", child.prColorClass)} />
                    ) : (
                      <GitBranchIcon className="size-3.5 text-muted-foreground/70" />
                    )}
                  </span>
                )}
                {onOpenBranch ? (
                  <button
                    type="button"
                    className="min-w-0 flex-1 truncate text-left hover:text-foreground focus-visible:outline-hidden focus-visible:ring-1 focus-visible:ring-ring"
                    onClick={(event) => {
                      event.preventDefault();
                      event.stopPropagation();
                      onOpenBranch(child.id);
                    }}
                    title={`Open ${child.title}`}
                  >
                    {child.title}
                  </button>
                ) : (
                  <span className="min-w-0 flex-1 truncate">{child.title}</span>
                )}
                {child.timeLabel ? (
                  <span className="shrink-0 text-[10px] tabular-nums text-muted-foreground/55">
                    {child.timeLabel}
                  </span>
                ) : null}
                {child.status ? (
                  <span
                    className="ml-1 inline-flex size-3.5 shrink-0 items-center justify-center"
                    title={child.status.label}
                    aria-label={child.status.label}
                  >
                    <SidebarStatusTrailingGlyph status={child.status} />
                  </span>
                ) : null}
                </div>
              );
            })}
          </div>
        </div>
      ) : null}
    </div>
  );
}
