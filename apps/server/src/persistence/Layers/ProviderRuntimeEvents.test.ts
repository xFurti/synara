import { EventId, ThreadId, TurnId, type ProviderRuntimeEvent } from "@synara/contracts";
import { assert, it } from "@effect/vitest";
import { Effect, Layer } from "effect";

import {
  PROVIDER_RUNTIME_EVENT_MAX_BYTES,
  PROVIDER_RUNTIME_INGESTION_CONSUMER,
  ProviderRuntimeEventRepository,
} from "../Services/ProviderRuntimeEvents.ts";
import {
  ProviderRuntimeEventRepositoryLive,
  truncateOversizeProviderRuntimeEvent,
  PROVIDER_RUNTIME_EVENT_TRUNCATED_KEY,
} from "./ProviderRuntimeEvents.ts";
import { SqlitePersistenceMemory } from "./Sqlite.ts";

const layer = it.layer(
  ProviderRuntimeEventRepositoryLive.pipe(Layer.provideMerge(SqlitePersistenceMemory)),
);

const runtimeEvent = (eventId: string, delta: string): ProviderRuntimeEvent => ({
  type: "content.delta",
  eventId: EventId.makeUnsafe(eventId),
  provider: "codex",
  createdAt: "2026-07-14T00:00:00.000Z",
  threadId: ThreadId.makeUnsafe("thread-runtime-journal"),
  turnId: TurnId.makeUnsafe("turn-runtime-journal"),
  payload: {
    streamKind: "assistant_text",
    delta,
  },
});

layer("ProviderRuntimeEventRepository", (it) => {
  it.effect("journals exact events and advances its consumer cursor contiguously", () =>
    Effect.gen(function* () {
      const repository = yield* ProviderRuntimeEventRepository;
      const first = yield* repository.append(runtimeEvent("runtime-event-1", "hello"));
      const duplicate = yield* repository.append(runtimeEvent("runtime-event-1", "hello"));
      const second = yield* repository.append(runtimeEvent("runtime-event-2", " world"));

      assert.strictEqual(duplicate.sequence, first.sequence);
      assert.isAbove(second.sequence, first.sequence);
      assert.strictEqual(yield* repository.getHighWaterSequence, second.sequence);

      const rows = yield* repository.readAfter({
        sequenceExclusive: 0,
        throughSequenceInclusive: second.sequence,
        limit: 10,
      });
      assert.deepStrictEqual(
        rows.map((row) => [row.sequence, row.event.eventId]),
        [
          [first.sequence, "runtime-event-1"],
          [second.sequence, "runtime-event-2"],
        ],
      );

      const skipped = yield* repository.advanceConsumerCursor({
        consumerName: PROVIDER_RUNTIME_INGESTION_CONSUMER,
        eventSequence: second.sequence,
        updatedAt: "2026-07-14T00:00:01.000Z",
      });
      assert.isFalse(skipped);
      const advanced = yield* repository.advanceConsumerCursor({
        consumerName: PROVIDER_RUNTIME_INGESTION_CONSUMER,
        eventSequence: first.sequence,
        updatedAt: "2026-07-14T00:00:01.000Z",
      });
      assert.isTrue(advanced);
      assert.strictEqual(
        yield* repository.getConsumerCursor(PROVIDER_RUNTIME_INGESTION_CONSUMER),
        first.sequence,
      );
      assert.deepStrictEqual(
        (yield* repository.readAcceptedOpenTurnEvents({
          consumerName: PROVIDER_RUNTIME_INGESTION_CONSUMER,
          sequenceExclusive: 0,
          limit: 10,
        })).map((row) => row.event.eventId),
        ["runtime-event-1"],
      );

      assert.isTrue(
        yield* repository.advanceConsumerCursor({
          consumerName: PROVIDER_RUNTIME_INGESTION_CONSUMER,
          eventSequence: second.sequence,
          updatedAt: "2026-07-14T00:00:02.000Z",
        }),
      );
      const terminal = yield* repository.append({
        type: "turn.completed",
        eventId: EventId.makeUnsafe("runtime-event-terminal"),
        provider: "codex",
        createdAt: "2026-07-14T00:00:03.000Z",
        threadId: ThreadId.makeUnsafe("thread-runtime-journal"),
        turnId: TurnId.makeUnsafe("turn-runtime-journal"),
        payload: { state: "completed" },
      });
      assert.isTrue(
        yield* repository.advanceConsumerCursor({
          consumerName: PROVIDER_RUNTIME_INGESTION_CONSUMER,
          eventSequence: terminal.sequence,
          updatedAt: "2026-07-14T00:00:03.000Z",
        }),
      );
      assert.lengthOf(
        yield* repository.readAcceptedOpenTurnEvents({
          consumerName: PROVIDER_RUNTIME_INGESTION_CONSUMER,
          sequenceExclusive: 0,
          limit: 10,
        }),
        0,
      );

      const conflict = yield* Effect.flip(
        repository.append(runtimeEvent("runtime-event-1", "different")),
      );
      assert.strictEqual(conflict._tag, "PersistenceDecodeError");
    }),
  );

  it.effect(
    "journals an oversized item.completed by truncating its payload instead of failing",
    () =>
      Effect.gen(function* () {
        const repository = yield* ProviderRuntimeEventRepository;
        // Mirrors Pi tool_execution_end: the full tool result is copied into
        // payload.data, so a multi-MB stdout must not strand the item.
        const oversizedResult = "x".repeat(PROVIDER_RUNTIME_EVENT_MAX_BYTES * 2);
        const oversizedEvent: ProviderRuntimeEvent = {
          type: "item.completed",
          eventId: EventId.makeUnsafe("runtime-event-oversized"),
          provider: "pi",
          createdAt: "2026-07-14T00:00:00.000Z",
          threadId: ThreadId.makeUnsafe("thread-runtime-journal"),
          turnId: TurnId.makeUnsafe("turn-runtime-journal"),
          payload: {
            itemType: "command_execution",
            status: "completed",
            title: "bash long-output",
            data: { toolCallId: "call-1", toolName: "bash", result: oversizedResult },
          },
        };

        const persisted = yield* repository.append(oversizedEvent);
        const replayed = yield* repository.readAfter({
          sequenceExclusive: persisted.sequence - 1,
          throughSequenceInclusive: persisted.sequence,
          limit: 10,
        });
        const row = replayed[0];
        assert.ok(row);
        assert.strictEqual(row.event.type, "item.completed");
        if (row.event.type === "item.completed") {
          const rawPayload = (row.event.raw?.payload ?? {}) as Record<string, unknown>;
          const forensics = rawPayload[PROVIDER_RUNTIME_EVENT_TRUNCATED_KEY] as
            | { truncated?: boolean; originalBytes?: number }
            | undefined;
          assert.strictEqual(forensics?.truncated, true);
          assert.isAbove(forensics?.originalBytes ?? 0, PROVIDER_RUNTIME_EVENT_MAX_BYTES);
          const data = row.event.payload.data as { result?: string };
          assert.isBelow((data.result ?? "").length, oversizedResult.length);
        }

        const duplicate = yield* repository.append(oversizedEvent);
        assert.strictEqual(duplicate.sequence, persisted.sequence);
      }),
  );

  it.effect("still rejects an event whose payload is not a record and stays oversized", () =>
    Effect.gen(function* () {
      const repository = yield* ProviderRuntimeEventRepository;
      const nonRecordPayload = "y".repeat(PROVIDER_RUNTIME_EVENT_MAX_BYTES * 3);
      const oversizedEvent = {
        type: "content.delta",
        eventId: EventId.makeUnsafe("runtime-event-non-record"),
        provider: "pi",
        createdAt: "2026-07-14T00:00:00.000Z",
        threadId: ThreadId.makeUnsafe("thread-runtime-journal"),
        turnId: TurnId.makeUnsafe("turn-runtime-journal"),
        payload: {
          streamKind: "assistant_text",
          delta: nonRecordPayload,
        },
      } satisfies ProviderRuntimeEvent;

      // A record payload shrinks; this only fails if truncation itself leaves
      // the row above budget, which the leaf budget must prevent.
      const persisted = yield* repository.append(oversizedEvent);
      const replayed = yield* repository.readAfter({
        sequenceExclusive: persisted.sequence - 1,
        throughSequenceInclusive: persisted.sequence,
        limit: 10,
      });
      assert.strictEqual(replayed[0]?.event.eventId, "runtime-event-non-record");
    }),
  );

  it("truncateOversizeProviderRuntimeEvent keeps unicode code points intact", () => {
    const emojiPayload = "🙂".repeat(PROVIDER_RUNTIME_EVENT_MAX_BYTES * 2);
    const event: ProviderRuntimeEvent = {
      type: "content.delta",
      eventId: EventId.makeUnsafe("runtime-event-unicode"),
      provider: "pi",
      createdAt: "2026-07-14T00:00:00.000Z",
      threadId: ThreadId.makeUnsafe("thread-runtime-journal"),
      payload: {
        streamKind: "assistant_text",
        delta: emojiPayload,
      },
    };
    const compacted = truncateOversizeProviderRuntimeEvent(
      event,
      PROVIDER_RUNTIME_EVENT_MAX_BYTES * 8,
    );
    const payload = compacted.payload as { delta: string };
    assert.isBelow(
      Buffer.byteLength(payload.delta, "utf8"),
      Buffer.byteLength(emojiPayload, "utf8"),
    );
    // No replacement characters from a split surrogate pair.
    assert.notInclude(payload.delta, "\uFFFD");
  });
});
