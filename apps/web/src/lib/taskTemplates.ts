// FILE: taskTemplates.ts
// Purpose: User-editable new-task presets stored on AppSettings.
// Layer: Web settings/domain helper
// Exports: seed templates, schema helpers, apply, and summary chips

import {
  PROVIDER_DISPLAY_NAMES,
  ProviderInteractionMode,
  ProviderKind,
  THREAD_GOAL_MAX_CHARS,
  type ThreadId,
  TrimmedNonEmptyString,
} from "@synara/contracts";
import { Schema } from "effect";
import { getDefaultModel } from "@synara/shared/model";

import type { ComposerDraftStoreState } from "../composerDraftDomain";

export const TASK_TEMPLATE_NAME_MAX_CHARS = 40;
export const TASK_TEMPLATE_PROMPT_MAX_CHARS = 8_192;
export const TASK_TEMPLATE_MAX_COUNT = 20;
export const TASK_TEMPLATE_ID_MAX_CHARS = 24;

export const TaskTemplateEnvMode = Schema.Literals(["local", "worktree"]);
export type TaskTemplateEnvMode = typeof TaskTemplateEnvMode.Type;

export const TaskTemplate = Schema.Struct({
  id: TrimmedNonEmptyString.check(Schema.isMaxLength(TASK_TEMPLATE_ID_MAX_CHARS)),
  name: TrimmedNonEmptyString.check(Schema.isMaxLength(TASK_TEMPLATE_NAME_MAX_CHARS)),
  provider: Schema.optional(ProviderKind),
  interactionMode: Schema.optional(ProviderInteractionMode),
  envMode: Schema.optional(TaskTemplateEnvMode),
  goal: Schema.optional(Schema.String.check(Schema.isMaxLength(THREAD_GOAL_MAX_CHARS))),
  prompt: Schema.String.check(Schema.isMaxLength(TASK_TEMPLATE_PROMPT_MAX_CHARS)),
});
export type TaskTemplate = typeof TaskTemplate.Type;

export const BUILT_IN_TASK_TEMPLATES: ReadonlyArray<TaskTemplate> = [
  {
    id: "bugfix",
    name: "Bugfix",
    envMode: "worktree",
    interactionMode: "default",
    prompt: [
      "Fix this bug.",
      "",
      "Repro:",
      "Expected:",
      "Actual:",
      "",
      "Find the cause, implement the smallest correct fix, and verify it.",
    ].join("\n"),
  },
  {
    id: "review",
    name: "Review",
    interactionMode: "plan",
    prompt: [
      "Review the current diff.",
      "",
      "Cover correctness, regressions, missing tests, and anything I should change before merging.",
      "Do not apply the changes unless I ask.",
    ].join("\n"),
  },
  {
    id: "spike",
    name: "Spike",
    envMode: "worktree",
    interactionMode: "plan",
    prompt: [
      "Time-boxed investigation.",
      "",
      "Goal:",
      "Constraints:",
      "",
      "Explore options, recommend one path, and list remaining unknowns. Prefer a short written plan over code unless a tiny prototype is needed.",
    ].join("\n"),
  },
];

export function taskTemplateSummaryChips(template: TaskTemplate): ReadonlyArray<string> {
  const chips: string[] = [];
  if (template.provider) {
    chips.push(PROVIDER_DISPLAY_NAMES[template.provider]);
  }
  if (template.envMode === "worktree") {
    chips.push("Worktree");
  } else if (template.envMode === "local") {
    chips.push("Local");
  }
  if (template.interactionMode === "plan") {
    chips.push("Plan");
  } else if (template.interactionMode === "debug") {
    chips.push("Debug");
  }
  return chips;
}

export function nextTaskTemplateId(existingIds: Iterable<string>): string {
  const taken = new Set(existingIds);
  let suffix = 1;
  while (suffix < 10_000) {
    const candidate = `template-${suffix}`;
    if (!taken.has(candidate)) {
      return candidate;
    }
    suffix += 1;
  }
  return `template-${Date.now()}`.slice(0, TASK_TEMPLATE_ID_MAX_CHARS);
}

export function createBlankTaskTemplate(existingIds: Iterable<string>): TaskTemplate {
  return {
    id: nextTaskTemplateId(existingIds),
    name: "New template",
    prompt: "",
  };
}

export function applyTaskTemplate(
  threadId: ThreadId,
  template: TaskTemplate,
  store: Pick<
    ComposerDraftStoreState,
    "setModelSelection" | "setInteractionMode" | "setDraftThreadContext" | "setPrompt"
  >,
): void {
  if (template.provider) {
    const model = getDefaultModel(template.provider);
    if (model) {
      store.setModelSelection(threadId, {
        provider: template.provider,
        model,
      });
    }
  }
  if (template.interactionMode) {
    store.setInteractionMode(threadId, template.interactionMode);
  }
  if (template.envMode || template.goal) {
    store.setDraftThreadContext(threadId, {
      ...(template.envMode ? { envMode: template.envMode } : {}),
      ...(template.goal ? { goal: template.goal } : {}),
    });
  }
  store.setPrompt(threadId, template.prompt);
}
