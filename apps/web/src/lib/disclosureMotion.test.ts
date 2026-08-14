import { describe, expect, it } from "vitest";

import {
  disclosureChevronClassName,
  disclosureContentClassName,
  disclosureFadeClassName,
  disclosureShellClassName,
  DISCLOSURE_CHEVRON_MOTION_CLASS,
  DISCLOSURE_COLLAPSIBLE_PANEL_CLASS,
  DISCLOSURE_FADE_MOTION_CLASS,
  DISCLOSURE_FADE_OPEN_CLASS,
  DISCLOSURE_FADE_CLOSED_CLASS,
  DISCLOSURE_SHELL_MOTION_CLASS,
  DISCLOSURE_SHELL_CLOSED_CLASS,
  DISCLOSURE_SHELL_OPEN_CLASS,
} from "./disclosureMotion";

describe("disclosureMotion", () => {
  it("maps open state to the shared shell classes", () => {
    expect(disclosureShellClassName(true)).toContain(DISCLOSURE_SHELL_OPEN_CLASS);
    expect(disclosureShellClassName(false)).toContain(DISCLOSURE_SHELL_CLOSED_CLASS);
  });

  it("rotates the chevron when open", () => {
    expect(disclosureChevronClassName(true)).toContain("rotate-90");
    expect(disclosureChevronClassName(false)).not.toContain("rotate-90");
  });

  it("disables interaction on closed content", () => {
    expect(disclosureContentClassName(false)).toContain("pointer-events-none");
    expect(disclosureContentClassName(true)).not.toContain("pointer-events-none");
  });

  it("keeps every disclosure path on the shared 220ms reduced-motion contract", () => {
    for (const className of [
      DISCLOSURE_SHELL_MOTION_CLASS,
      DISCLOSURE_CHEVRON_MOTION_CLASS,
      DISCLOSURE_COLLAPSIBLE_PANEL_CLASS,
      DISCLOSURE_FADE_MOTION_CLASS,
    ]) {
      expect(className).toContain("duration-220");
      expect(className).toContain("motion-reduce:transition-none");
    }
  });

  it("fades inline badges in place without translating them", () => {
    expect(disclosureFadeClassName(true)).toContain(DISCLOSURE_FADE_OPEN_CLASS);
    expect(disclosureFadeClassName(false)).toContain(DISCLOSURE_FADE_CLOSED_CLASS);
    expect(disclosureFadeClassName(false)).toContain("opacity-0");
    expect(disclosureFadeClassName(false)).toContain("pointer-events-none");
    expect(disclosureFadeClassName(false)).not.toContain("-translate-");
    expect(disclosureFadeClassName(true)).not.toContain("pointer-events-none");
  });

  it("uses ease-out on open and ease-in on close so the fold accelerates", () => {
    expect(DISCLOSURE_SHELL_OPEN_CLASS).toContain("ease-out");
    expect(DISCLOSURE_SHELL_CLOSED_CLASS).toContain("ease-in");
    expect(disclosureContentClassName(true)).toContain("ease-out");
    expect(disclosureContentClassName(false)).toContain("ease-in");
    expect(disclosureContentClassName(false)).not.toContain("opacity-");
  });
});
