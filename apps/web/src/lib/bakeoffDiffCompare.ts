// FILE: bakeoffDiffCompare.ts
// Purpose: Classify bake-off working-tree paths into A-only / B-only / both.
// Layer: Web domain helper
// Exports: union-path classification for the split compare list

export interface BakeoffDiffFile {
  readonly path: string;
}

export type BakeoffDiffPathKind = "left" | "right" | "both";

export interface BakeoffDiffPathEntry {
  readonly path: string;
  readonly kind: BakeoffDiffPathKind;
}

export function classifyBakeoffDiffPaths(
  leftFiles: readonly BakeoffDiffFile[],
  rightFiles: readonly BakeoffDiffFile[],
): ReadonlyArray<BakeoffDiffPathEntry> {
  const left = new Set(leftFiles.map((file) => file.path).filter((path) => path.length > 0));
  const right = new Set(rightFiles.map((file) => file.path).filter((path) => path.length > 0));
  const paths = [...new Set([...left, ...right])].toSorted((a, b) => a.localeCompare(b));
  return paths.map((path) => {
    const inLeft = left.has(path);
    const inRight = right.has(path);
    return {
      path,
      kind: inLeft && inRight ? "both" : inLeft ? "left" : "right",
    };
  });
}
