import assert from "node:assert/strict";
import { describe, it } from "vitest";

import { buildThreadLink, parseThreadIdFromAppUrl } from "./threadLink";

const THREAD_ID = "8ea6994a-56b7-4e42-9b0f-ea39dd25bd83";

describe("threadLink", () => {
  it("builds a web path URL", () => {
    assert.equal(
      buildThreadLink(THREAD_ID, { origin: "http://127.0.0.1:3773/", isElectron: false }),
      `http://127.0.0.1:3773/${THREAD_ID}`,
    );
  });

  it("builds a desktop hash URL", () => {
    assert.equal(
      buildThreadLink(THREAD_ID, { origin: "synara://app", isElectron: true }),
      `synara://app/index.html#/${THREAD_ID}`,
    );
  });

  it("parses web, hash, and canary URLs", () => {
    assert.equal(parseThreadIdFromAppUrl(`http://127.0.0.1:3773/${THREAD_ID}`), THREAD_ID);
    assert.equal(
      parseThreadIdFromAppUrl(`synara://app/index.html#/${THREAD_ID}`),
      THREAD_ID,
    );
    assert.equal(
      parseThreadIdFromAppUrl(`synara-canary://app/index.html#/${THREAD_ID}`),
      THREAD_ID,
    );
  });

  it("returns null for unrelated URLs", () => {
    assert.equal(parseThreadIdFromAppUrl("synara://app/index.html#/settings"), null);
  });
});
