// FILE: EnvironmentTestsSection.tsx
// Purpose: Per-task test runner in the Environment panel. Local scripts only — not PR checks.
// Layer: Environment panel section
// Nested PTY session exit is not treated as the test result.

import type { ProjectScript, ThreadId } from "@synara/contracts";
import { useEffect, useMemo, useRef, useState } from "react";

import { PlayIcon } from "~/lib/icons";
import { readNativeApi } from "~/nativeApi";
import { projectScriptCwd } from "~/projectScripts";
import { runProjectCommandInTerminal } from "~/projectTerminalRunner";
import { useTerminalStateStore } from "~/terminalStateStore";
import { getThreadFromState } from "~/threadDerivation";
import { DEFAULT_THREAD_TERMINAL_ID } from "~/types";
import {
  fallbackTestCommand,
  parseTestCommandOutput,
  selectThreadTestScripts,
  settleTestRunFromOutput,
  type ThreadTestRunStatus,
} from "~/lib/threadTestResults";
import { useStore } from "~/store";

import {
  ENVIRONMENT_ROW_ICON_CLASS_NAME,
  EnvironmentLabeledSection,
  EnvironmentRow,
} from "./EnvironmentRow";

export function EnvironmentTestsSection({
  threadId,
  enabled,
}: {
  threadId: ThreadId;
  enabled: boolean;
}) {
  const thread = useStore((store) => getThreadFromState(store, threadId));
  const project = useStore((store) =>
    thread ? (store.projects.find((candidate) => candidate.id === thread.projectId) ?? null) : null,
  );
  const scripts = useMemo(
    () => selectThreadTestScripts(project?.scripts ?? []),
    [project?.scripts],
  );
  const setTerminalOpen = useTerminalStateStore((store) => store.setTerminalOpen);
  const [statusByScript, setStatusByScript] = useState<
    Record<string, { status: ThreadTestRunStatus; summary: string }>
  >({});
  const unsubscribersRef = useRef<Array<() => void>>([]);

  useEffect(() => {
    return () => {
      for (const unsubscribe of unsubscribersRef.current) {
        unsubscribe();
      }
      unsubscribersRef.current = [];
    };
  }, [threadId]);

  if (!enabled || !thread || !project) {
    return null;
  }

  const runScript = async (script: ProjectScript | null) => {
    const api = readNativeApi();
    if (!api) return;
    const command = script?.command ?? fallbackTestCommand();
    const key = script?.id ?? "fallback-bun-test";
    const terminalId = DEFAULT_THREAD_TERMINAL_ID;
    setStatusByScript((current) => ({
      ...current,
      [key]: { status: "running", summary: "Running…" },
    }));
    setTerminalOpen(threadId, true);
    let output = "";
    const unsubscribe = api.terminal.onEvent((event) => {
      if (event.threadId !== threadId || event.terminalId !== terminalId) {
        return;
      }
      if (event.type === "output") {
        output += event.data;
        const parsed = parseTestCommandOutput(output);
        if (parsed) {
          setStatusByScript((current) => ({
            ...current,
            [key]: { status: parsed.status, summary: parsed.summary },
          }));
        }
      }
      if (event.type === "activity" && !event.hasRunningSubprocess) {
        const settled = settleTestRunFromOutput({ output, ptyExited: false });
        setStatusByScript((current) => ({
          ...current,
          [key]: { status: settled.status, summary: settled.summary },
        }));
      }
      if (event.type === "exited") {
        const settled = settleTestRunFromOutput({ output, ptyExited: true });
        setStatusByScript((current) => ({
          ...current,
          [key]: { status: settled.status, summary: settled.summary },
        }));
      }
    });
    unsubscribersRef.current.push(unsubscribe);
    try {
      await runProjectCommandInTerminal({
        api,
        threadId,
        terminalId,
        project: { cwd: project.cwd },
        cwd: projectScriptCwd({
          project: { cwd: project.cwd },
          worktreePath: thread.worktreePath,
        }),
        command,
        worktreePath: thread.worktreePath,
      });
    } catch (error) {
      setStatusByScript((current) => ({
        ...current,
        [key]: {
          status: "failed",
          summary: error instanceof Error ? error.message : "Could not start tests.",
        },
      }));
    }
  };

  const rows: Array<{ key: string; label: string; script: ProjectScript | null }> =
    scripts.length > 0
      ? scripts.map((script) => ({ key: script.id, label: script.name, script }))
      : [{ key: "fallback-bun-test", label: "bun run test", script: null }];

  return (
    <EnvironmentLabeledSection label="Tests">
      {rows.map((row) => {
        const result = statusByScript[row.key];
        return (
          <EnvironmentRow
            key={row.key}
            icon={<PlayIcon className={ENVIRONMENT_ROW_ICON_CLASS_NAME} aria-hidden />}
            label={<span className="truncate">{row.label}</span>}
            trailing={
              <span className="max-w-[9rem] truncate text-[length:var(--app-font-size-ui-xs,10px)] text-muted-foreground">
                {result?.status === "running"
                  ? "Running"
                  : result?.status === "passed"
                    ? result.summary
                    : result?.status === "failed"
                      ? result.summary
                      : (result?.summary ?? "Run")}
              </span>
            }
            onClick={() => void runScript(row.script)}
          />
        );
      })}
    </EnvironmentLabeledSection>
  );
}
