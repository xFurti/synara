import { describe, expect, it } from "vitest";

import {
  fallbackTestCommand,
  isTestProjectScript,
  parseTestCommandOutput,
  selectThreadTestScripts,
  settleTestRunFromOutput,
} from "./threadTestResults";

const script = (
  partial: Partial<{
    id: string;
    name: string;
    command: string;
    icon: "play" | "test" | "lint" | "configure" | "build" | "debug";
    runOnWorktreeCreate: boolean;
  }>,
) => ({
  id: partial.id ?? "script",
  name: partial.name ?? "Script",
  command: partial.command ?? "echo hi",
  icon: partial.icon ?? "play",
  runOnWorktreeCreate: partial.runOnWorktreeCreate ?? false,
});

describe("threadTestResults", () => {
  it("matches test scripts by icon or name, and skips worktree setup scripts", () => {
    expect(isTestProjectScript(script({ icon: "test" }))).toBe(true);
    expect(isTestProjectScript(script({ name: "Unit tests", command: "vitest" }))).toBe(true);
    expect(isTestProjectScript(script({ name: "Dev server", command: "vite" }))).toBe(false);
    expect(
      selectThreadTestScripts([
        script({ id: "test", name: "Test", command: "bun run test", icon: "test" }),
        script({
          id: "setup",
          name: "Install",
          command: "bun install",
          icon: "test",
          runOnWorktreeCreate: true,
        }),
      ]).map((item) => item.id),
    ).toEqual(["test"]);
  });

  it("parses vitest, jest, and pytest summaries", () => {
    expect(parseTestCommandOutput("Tests 12 passed (2.1s)")).toEqual({
      status: "passed",
      summary: "12 passed",
      passed: 12,
      failed: 0,
    });
    expect(parseTestCommandOutput("Tests 10 passed | 2 failed")).toEqual({
      status: "failed",
      summary: "10 passed, 2 failed",
      passed: 10,
      failed: 2,
    });
    expect(parseTestCommandOutput("Tests: 1 failed, 8 passed, 9 total")).toEqual({
      status: "failed",
      summary: "8 passed, 1 failed",
      passed: 8,
      failed: 1,
    });
    expect(parseTestCommandOutput("========== 4 passed in 0.12s ==========\npytest")).toEqual({
      status: "passed",
      summary: "4 passed",
      passed: 4,
      failed: 0,
    });
  });

  it("does not treat nested PTY exit as a test failure", () => {
    expect(settleTestRunFromOutput({ output: "still running", ptyExited: true })).toEqual({
      status: "unknown",
      summary: "Finished — check the terminal for the result",
    });
    expect(settleTestRunFromOutput({ output: "Tests 3 passed", ptyExited: true }).status).toBe(
      "passed",
    );
  });

  it("falls back to bun run test", () => {
    expect(fallbackTestCommand()).toBe("bun run test");
  });
});
