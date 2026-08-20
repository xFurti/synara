import { ThreadId } from "@synara/contracts";
import { describe, expect, it, vi } from "vitest";

import {
  applyTaskTemplate,
  BUILT_IN_TASK_TEMPLATES,
  createBlankTaskTemplate,
  nextTaskTemplateId,
  taskTemplateSummaryChips,
} from "./taskTemplates";

describe("taskTemplates", () => {
  it("seeds bugfix, review, and spike", () => {
    expect(BUILT_IN_TASK_TEMPLATES.map((template) => template.id)).toEqual([
      "bugfix",
      "review",
      "spike",
    ]);
  });

  it("summarizes optional chips and omits unset fields", () => {
    expect(taskTemplateSummaryChips(BUILT_IN_TASK_TEMPLATES[0]!)).toEqual(["Worktree"]);
    expect(taskTemplateSummaryChips(BUILT_IN_TASK_TEMPLATES[1]!)).toEqual(["Plan"]);
    expect(
      taskTemplateSummaryChips({
        id: "custom",
        name: "Custom",
        provider: "grok",
        envMode: "local",
        interactionMode: "debug",
        prompt: "",
      }),
    ).toEqual(["Grok", "Local", "Debug"]);
  });

  it("allocates unique template ids", () => {
    expect(nextTaskTemplateId(["template-1"])).toBe("template-2");
    expect(createBlankTaskTemplate(["template-1"]).id).toBe("template-2");
  });

  it("applies provider, mode, env, goal, and prompt in order", () => {
    const setModelSelection = vi.fn();
    const setInteractionMode = vi.fn();
    const setDraftThreadContext = vi.fn();
    const setPrompt = vi.fn();
    const threadId = ThreadId.makeUnsafe("11111111-1111-4111-8111-111111111111");

    applyTaskTemplate(
      threadId,
      {
        id: "custom",
        name: "Custom",
        provider: "codex",
        interactionMode: "plan",
        envMode: "worktree",
        goal: "Ship the fix",
        prompt: "Do the thing",
      },
      { setModelSelection, setInteractionMode, setDraftThreadContext, setPrompt },
    );

    expect(setModelSelection).toHaveBeenCalledWith(
      threadId,
      expect.objectContaining({ provider: "codex" }),
    );
    expect(setInteractionMode).toHaveBeenCalledWith(threadId, "plan");
    expect(setDraftThreadContext).toHaveBeenCalledWith(threadId, {
      envMode: "worktree",
      goal: "Ship the fix",
    });
    expect(setPrompt).toHaveBeenCalledWith(threadId, "Do the thing");
  });

  it("leaves optional fields alone when omitted", () => {
    const setModelSelection = vi.fn();
    const setInteractionMode = vi.fn();
    const setDraftThreadContext = vi.fn();
    const setPrompt = vi.fn();
    const threadId = ThreadId.makeUnsafe("11111111-1111-4111-8111-111111111111");

    applyTaskTemplate(
      threadId,
      { id: "plain", name: "Plain", prompt: "Hello" },
      { setModelSelection, setInteractionMode, setDraftThreadContext, setPrompt },
    );

    expect(setModelSelection).not.toHaveBeenCalled();
    expect(setInteractionMode).not.toHaveBeenCalled();
    expect(setDraftThreadContext).not.toHaveBeenCalled();
    expect(setPrompt).toHaveBeenCalledWith(threadId, "Hello");
  });
});
