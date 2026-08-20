// FILE: TaskTemplatesSettings.tsx
// Purpose: Settings editor for user-editable new-task templates.
// Layer: Settings UI

import { PROVIDER_DISPLAY_NAMES, type ProviderKind } from "@synara/contracts";
import { useState } from "react";

import type { AppSettings } from "~/appSettings";
import { DisclosureRegion } from "~/components/ui/DisclosureRegion";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { SelectItem } from "~/components/ui/select";
import { Textarea } from "~/components/ui/textarea";
import {
  TASK_TEMPLATE_MAX_COUNT,
  createBlankTaskTemplate,
  taskTemplateSummaryChips,
  type TaskTemplate,
} from "~/lib/taskTemplates";
import { SETTINGS_TARGETS } from "~/settingsNavigation";
import { DEFAULT_PROVIDER_ORDER } from "~/providerOrdering";

import { SettingsSelectControl } from "./SettingControls";
import {
  SettingsListRow,
  SettingsRow,
  SettingsSection,
  SettingsEmptyState,
} from "./SettingsPanelPrimitives";

const PROVIDER_OPTIONS: ReadonlyArray<ProviderKind | ""> = ["", ...DEFAULT_PROVIDER_ORDER];

export function TaskTemplatesSettings({
  templates,
  onChange,
}: {
  templates: ReadonlyArray<TaskTemplate>;
  onChange: (templates: AppSettings["taskTemplates"]) => void;
}) {
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const updateTemplate = (id: string, patch: Partial<TaskTemplate>) => {
    onChange(
      templates.map((template) => (template.id === id ? { ...template, ...patch } : template)),
    );
  };

  return (
    <div id={SETTINGS_TARGETS.taskTemplates} className="space-y-3">
      <SettingsSection title="Task templates">
        {templates.length === 0 ? (
          <SettingsEmptyState layout="status">
            No templates. Add one to start new tasks from a prompt skeleton.
          </SettingsEmptyState>
        ) : (
          templates.map((template) => {
            const open = expandedId === template.id;
            const chips = taskTemplateSummaryChips(template);
            return (
              <div key={template.id}>
                <SettingsListRow
                  title={template.name}
                  description={chips.length > 0 ? chips.join(" · ") : "No defaults"}
                  actions={
                    <Button
                      type="button"
                      size="xs"
                      variant="outline"
                      onClick={() => setExpandedId(open ? null : template.id)}
                    >
                      {open ? "Done" : "Edit"}
                    </Button>
                  }
                />
                <DisclosureRegion open={open}>
                  <div className="space-y-3 px-4 py-3">
                    <SettingsRow
                      title="Name"
                      description="Shown in the new-task menu and command palette."
                      control={
                        <Input
                          value={template.name}
                          maxLength={40}
                          onChange={(event) =>
                            updateTemplate(template.id, { name: event.target.value })
                          }
                          aria-label={`${template.name} template name`}
                        />
                      }
                    />
                    <SettingsRow
                      title="Provider"
                      description="Leave as Default to use the app default provider."
                      control={
                        <SettingsSelectControl
                          value={template.provider ?? "default"}
                          onValueChange={(value) =>
                            updateTemplate(template.id, {
                              provider: value === "default" ? undefined : (value as ProviderKind),
                            })
                          }
                          ariaLabel={`${template.name} provider`}
                          valueContent={
                            template.provider
                              ? PROVIDER_DISPLAY_NAMES[template.provider]
                              : "Default"
                          }
                        >
                          {PROVIDER_OPTIONS.map((provider) => (
                            <SelectItem
                              hideIndicator
                              key={provider || "default"}
                              value={provider || "default"}
                            >
                              {provider ? PROVIDER_DISPLAY_NAMES[provider] : "Default"}
                            </SelectItem>
                          ))}
                        </SettingsSelectControl>
                      }
                    />
                    <SettingsRow
                      title="Mode"
                      description="Chat, Plan, or Debug. Default keeps the current mode."
                      control={
                        <SettingsSelectControl
                          value={template.interactionMode ?? "inherit"}
                          onValueChange={(value) =>
                            updateTemplate(template.id, {
                              interactionMode:
                                value === "plan" || value === "debug" || value === "default"
                                  ? value
                                  : undefined,
                            })
                          }
                          ariaLabel={`${template.name} mode`}
                          valueContent={
                            template.interactionMode === "plan"
                              ? "Plan"
                              : template.interactionMode === "debug"
                                ? "Debug"
                                : template.interactionMode === "default"
                                  ? "Chat"
                                  : "Default"
                          }
                        >
                          <SelectItem hideIndicator value="inherit">
                            Default
                          </SelectItem>
                          <SelectItem hideIndicator value="default">
                            Chat
                          </SelectItem>
                          <SelectItem hideIndicator value="plan">
                            Plan
                          </SelectItem>
                          <SelectItem hideIndicator value="debug">
                            Debug
                          </SelectItem>
                        </SettingsSelectControl>
                      }
                    />
                    <SettingsRow
                      title="Workspace"
                      description="Local checkout or a new worktree. Default uses Settings → New threads."
                      control={
                        <SettingsSelectControl
                          value={template.envMode ?? "inherit"}
                          onValueChange={(value) =>
                            updateTemplate(template.id, {
                              envMode:
                                value === "local" || value === "worktree" ? value : undefined,
                            })
                          }
                          ariaLabel={`${template.name} workspace`}
                          valueContent={
                            template.envMode === "worktree"
                              ? "New worktree"
                              : template.envMode === "local"
                                ? "Local"
                                : "Default"
                          }
                        >
                          <SelectItem hideIndicator value="inherit">
                            Default
                          </SelectItem>
                          <SelectItem hideIndicator value="local">
                            Local
                          </SelectItem>
                          <SelectItem hideIndicator value="worktree">
                            New worktree
                          </SelectItem>
                        </SettingsSelectControl>
                      }
                    />
                    <label className="block space-y-1.5">
                      <span className="text-xs font-medium text-muted-foreground">Prompt</span>
                      <Textarea
                        value={template.prompt}
                        maxLength={8192}
                        rows={5}
                        onChange={(event) =>
                          updateTemplate(template.id, { prompt: event.target.value })
                        }
                      />
                    </label>
                    <div className="flex justify-end">
                      <Button
                        type="button"
                        size="xs"
                        variant="ghost"
                        onClick={() =>
                          onChange(templates.filter((candidate) => candidate.id !== template.id))
                        }
                      >
                        Delete
                      </Button>
                    </div>
                  </div>
                </DisclosureRegion>
              </div>
            );
          })
        )}
        <div className="px-4 py-3">
          <Button
            type="button"
            size="xs"
            variant="outline"
            disabled={templates.length >= TASK_TEMPLATE_MAX_COUNT}
            onClick={() => {
              const next = createBlankTaskTemplate(templates.map((template) => template.id));
              onChange([...templates, next]);
              setExpandedId(next.id);
            }}
          >
            Add template
          </Button>
        </div>
      </SettingsSection>
    </div>
  );
}
