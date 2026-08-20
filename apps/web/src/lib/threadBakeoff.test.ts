import { ThreadId } from "@synara/contracts";
import { describe, expect, it } from "vitest";

import {
  bakeoffThreadTitle,
  buildBakeoffPair,
  canOfferBakeoff,
  findBakeoffPeer,
  resolveBakeoffProviders,
} from "./threadBakeoff";

const leftId = ThreadId.makeUnsafe("11111111-1111-4111-8111-111111111111");
const rightId = ThreadId.makeUnsafe("22222222-2222-4222-8222-222222222222");

describe("threadBakeoff", () => {
  it("requires a git repo, another provider, and a non-bakeoff source", () => {
    expect(
      canOfferBakeoff({
        isGitRepo: true,
        thread: {
          bakeoff: null,
          parentThreadId: null,
          sidechatSourceThreadId: null,
          archivedAt: null,
        },
        otherUsableProviderCount: 1,
      }),
    ).toBe(true);
    expect(
      canOfferBakeoff({
        isGitRepo: false,
        thread: null,
        otherUsableProviderCount: 2,
      }),
    ).toBe(false);
    expect(
      canOfferBakeoff({
        isGitRepo: true,
        thread: {
          bakeoff: {
            experimentId: "e",
            peerThreadId: rightId,
            sourceThreadId: null,
            prompt: "x",
            baseRef: "main",
            role: "left",
            status: "running",
          },
          parentThreadId: null,
          sidechatSourceThreadId: null,
          archivedAt: null,
        },
        otherUsableProviderCount: 1,
      }),
    ).toBe(false);
  });

  it("resolves current vs first other, or two explicit providers", () => {
    expect(
      resolveBakeoffProviders({
        currentProvider: "codex",
        requestedProviders: [],
        usableProviders: ["codex", "grok", "claudeAgent"],
      }),
    ).toEqual({ left: "codex", right: "grok", unavailable: null });
    expect(
      resolveBakeoffProviders({
        currentProvider: "codex",
        requestedProviders: ["claudeAgent"],
        usableProviders: ["codex", "claudeAgent"],
      }),
    ).toEqual({ left: "codex", right: "claudeAgent", unavailable: null });
    expect(
      resolveBakeoffProviders({
        currentProvider: "codex",
        requestedProviders: ["grok", "claudeAgent"],
        usableProviders: ["grok"],
      }),
    ).toEqual({ left: "grok", right: null, unavailable: "claudeAgent" });
  });

  it("finds the peer by experiment id and tolerates a missing source", () => {
    const pair = buildBakeoffPair({
      experimentId: "exp-1",
      prompt: "implement X",
      baseRef: "main",
      sourceThreadId: null,
      leftThreadId: leftId,
      rightThreadId: rightId,
    });
    const left = { id: leftId, bakeoff: pair.left };
    const right = { id: rightId, bakeoff: pair.right };
    expect(findBakeoffPeer([left, right], left)?.id).toBe(rightId);
    expect(pair.left.sourceThreadId).toBeNull();
    expect(bakeoffThreadTitle({ prompt: "implement X", provider: "grok" })).toContain("Grok");
  });
});
