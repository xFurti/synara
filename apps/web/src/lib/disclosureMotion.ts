// FILE: disclosureMotion.ts
// Purpose: Shared open/close motion tokens for collapsible UI (sidebar lists, transcript panels, etc.).
// Layer: Web UI motion primitive
// Exports: class-name helpers + Collapsible panel tokens
// Why: Sidebar project/thread expand and chat disclosures reused the same grid/opacity
//      timing in multiple places; centralize it so new expand/collapse surfaces stay consistent.

import { cn } from "~/lib/utils";

export const DISCLOSURE_TRANSITION_MS = 220;
export const DISCLOSURE_CLEANUP_BUFFER_MS = 40;

/** Shell grid that animates height via grid-template-rows + fade. The easing is
 *  declared on the state classes, not here: CSS reads transition parameters from
 *  the destination style, so open uses `ease-out` (fast reveal) while close uses
 *  `ease-in` (starts slow, accelerates into the fold) instead of slamming shut
 *  and then crawling through a lingering sliver of rows. */
export const DISCLOSURE_SHELL_MOTION_CLASS =
  "grid transition-[grid-template-rows,opacity] duration-220 motion-reduce:transition-none";

export const DISCLOSURE_SHELL_OPEN_CLASS = "grid-rows-[1fr] opacity-100 ease-out";
export const DISCLOSURE_SHELL_CLOSED_CLASS = "grid-rows-[0fr] opacity-0 ease-in";

/** Required inner wrapper so grid-row collapse measures correctly. */
export const DISCLOSURE_INNER_CLASS = "min-h-0 overflow-hidden";

/** Content drift layered on top of the shell animation. The closed state slides
 *  the content up by its full height in lockstep with the grid collapse, so the
 *  block reads as a smooth roll-up/down instead of a hard cut line travelling
 *  through the rows. Opacity stays on the shell so the whole region fades as one
 *  unit: a per-content fade would blank the rows out before the grid collapse
 *  finishes, making close feel like the panel empties first and closes second.
 *  Easing is direction-specific like the shell: `ease-out` on open, `ease-in`
 *  on close so the fold accelerates instead of lingering on a sliver. */
export const DISCLOSURE_CONTENT_MOTION_CLASS =
  "transition-[transform] duration-220 motion-reduce:transition-none";

export const DISCLOSURE_CONTENT_OPEN_CLASS = "translate-y-0 ease-out";
export const DISCLOSURE_CONTENT_CLOSED_CLASS = "-translate-y-full ease-in pointer-events-none";

/** Fade-only toggle for inline badges that must not translate (e.g. the branch
 *  count chip inside a row): a roll-up would push the badge out of its row onto
 *  the neighboring text. Same 220ms direction-aware contract as the shell. The
 *  transform is kept in the transition so callers can layer scale pulses on top
 *  without fighting the motion class. */
export const DISCLOSURE_FADE_MOTION_CLASS =
  "transition-[opacity,transform] duration-220 motion-reduce:transition-none";
export const DISCLOSURE_FADE_OPEN_CLASS = "opacity-100 ease-out";
export const DISCLOSURE_FADE_CLOSED_CLASS = "opacity-0 ease-in pointer-events-none";

/** Chevron rotation paired with the shell motion. */
export const DISCLOSURE_CHEVRON_MOTION_CLASS =
  "size-3.5 shrink-0 text-muted-foreground transition-transform duration-220 ease-out motion-reduce:transition-none";

/** Base-ui Collapsible panel height animation using the same timing curve. */
export const DISCLOSURE_COLLAPSIBLE_PANEL_CLASS =
  "h-(--collapsible-panel-height) overflow-hidden transition-[height] duration-220 ease-out motion-reduce:transition-none data-ending-style:h-0 data-starting-style:h-0 data-open:data-ending-style:[height:var(--collapsible-panel-height)]";

/**
 * Inline-axis (width) reveal for side panels that open/close along the
 * horizontal axis. Same timing curve as the vertical disclosures so every
 * toggle in the app stays consistent. Pair `open ? openWidthClassName : "w-0"`.
 */
export const DISCLOSURE_WIDTH_MOTION_CLASS =
  "overflow-hidden transition-[width] duration-220 ease-out motion-reduce:transition-none";

export function disclosureWidthClassName(
  open: boolean,
  openWidthClassName: string,
  className?: string,
) {
  return cn(DISCLOSURE_WIDTH_MOTION_CLASS, open ? openWidthClassName : "w-0", className);
}

export function disclosureShellClassName(open: boolean, className?: string) {
  return cn(
    DISCLOSURE_SHELL_MOTION_CLASS,
    open ? DISCLOSURE_SHELL_OPEN_CLASS : DISCLOSURE_SHELL_CLOSED_CLASS,
    className,
  );
}

export function disclosureContentClassName(open: boolean, className?: string) {
  return cn(
    DISCLOSURE_CONTENT_MOTION_CLASS,
    open ? DISCLOSURE_CONTENT_OPEN_CLASS : DISCLOSURE_CONTENT_CLOSED_CLASS,
    className,
  );
}

export function disclosureFadeClassName(open: boolean, className?: string) {
  return cn(
    DISCLOSURE_FADE_MOTION_CLASS,
    open ? DISCLOSURE_FADE_OPEN_CLASS : DISCLOSURE_FADE_CLOSED_CLASS,
    className,
  );
}

export function disclosureChevronClassName(open: boolean, className?: string) {
  return cn(DISCLOSURE_CHEVRON_MOTION_CLASS, open && "rotate-90", className);
}
