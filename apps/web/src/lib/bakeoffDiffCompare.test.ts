import { describe, expect, it } from "vitest";

import { classifyBakeoffDiffPaths } from "./bakeoffDiffCompare";

describe("classifyBakeoffDiffPaths", () => {
  it("splits A-only, B-only, and shared paths", () => {
    expect(
      classifyBakeoffDiffPaths(
        [{ path: "src/a.ts" }, { path: "src/shared.ts" }],
        [{ path: "src/b.ts" }, { path: "src/shared.ts" }],
      ),
    ).toEqual([
      { path: "src/a.ts", kind: "left" },
      { path: "src/b.ts", kind: "right" },
      { path: "src/shared.ts", kind: "both" },
    ]);
  });

  it("ignores empty paths and sorts the union", () => {
    expect(classifyBakeoffDiffPaths([{ path: "z.ts" }, { path: "" }], [{ path: "a.ts" }])).toEqual([
      { path: "a.ts", kind: "right" },
      { path: "z.ts", kind: "left" },
    ]);
  });
});
