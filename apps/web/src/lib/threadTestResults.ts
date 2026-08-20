// FILE: threadTestResults.ts
// Purpose: Identify per-task test scripts and parse runner summaries from PTY output.
// Layer: Web domain helper
// Exports: test-script matching and output classification
// Nested PTY session exit is not a test result — only parsed summaries count.

import type { ProjectScript } from "@synara/contracts";

export type ThreadTestRunStatus = "idle" | "running" | "passed" | "failed" | "unknown";

export interface ThreadTestRunResult {
  readonly status: Exclude<ThreadTestRunStatus, "idle" | "running">;
  readonly summary: string;
  readonly passed?: number;
  readonly failed?: number;
}

const TEST_SCRIPT_NAME_PATTERN = /\b(test|tests|vitest|jest|pytest|mocha|playwright|cypress)\b/i;

export function isTestProjectScript(script: ProjectScript): boolean {
  if (script.icon === "test") {
    return true;
  }
  return TEST_SCRIPT_NAME_PATTERN.test(`${script.id} ${script.name} ${script.command}`);
}

export function selectThreadTestScripts(
  scripts: readonly ProjectScript[],
): ReadonlyArray<ProjectScript> {
  return scripts.filter((script) => isTestProjectScript(script) && !script.runOnWorktreeCreate);
}

export function fallbackTestCommand(): string {
  return "bun run test";
}

function toInt(value: string | undefined): number | undefined {
  if (!value) return undefined;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : undefined;
}

export function parseTestCommandOutput(output: string): ThreadTestRunResult | null {
  const text = output.replace(/\u001b\[[0-9;]*m/g, "");
  if (!text.trim()) {
    return null;
  }

  const vitest = text.match(/Tests?\s+(\d+)\s+passed(?:.*?(\d+)\s+failed)?/i);
  if (vitest) {
    const passed = toInt(vitest[1]) ?? 0;
    const failed = toInt(vitest[2]) ?? 0;
    return {
      status: failed > 0 ? "failed" : "passed",
      summary: failed > 0 ? `${passed} passed, ${failed} failed` : `${passed} passed`,
      passed,
      failed,
    };
  }

  const jest = text.match(/Tests:\s+(?:(\d+)\s+failed,\s+)?(?:(\d+)\s+passed)/i);
  if (jest) {
    const failed = toInt(jest[1]) ?? 0;
    const passed = toInt(jest[2]) ?? 0;
    return {
      status: failed > 0 ? "failed" : "passed",
      summary: failed > 0 ? `${passed} passed, ${failed} failed` : `${passed} passed`,
      passed,
      failed,
    };
  }

  const pytest = text.match(/(\d+)\s+passed(?:,\s+(\d+)\s+failed)?/i);
  if (pytest && /\b(pytest|=====)/i.test(text)) {
    const passed = toInt(pytest[1]) ?? 0;
    const failed = toInt(pytest[2]) ?? 0;
    return {
      status: failed > 0 ? "failed" : "passed",
      summary: failed > 0 ? `${passed} passed, ${failed} failed` : `${passed} passed`,
      passed,
      failed,
    };
  }

  if (/\bFAIL(ED)?\b/i.test(text) && /\b(test|spec|assert)/i.test(text)) {
    return { status: "failed", summary: "Tests failed" };
  }
  if (/\b(PASS(ED)?|OK)\b/i.test(text) && /\b(test|spec)\b/i.test(text)) {
    return { status: "passed", summary: "Tests passed" };
  }

  return null;
}

export function settleTestRunFromOutput(input: {
  readonly output: string;
  readonly ptyExited: boolean;
}): ThreadTestRunResult {
  const parsed = parseTestCommandOutput(input.output);
  if (parsed) {
    return parsed;
  }
  // Nested PTY close is not the test command's exit. If we never saw a runner
  // summary, surface an unknown result instead of treating session death as fail.
  if (input.ptyExited) {
    return {
      status: "unknown",
      summary: "Finished — check the terminal for the result",
    };
  }
  return {
    status: "unknown",
    summary: "No test summary in the output yet",
  };
}
