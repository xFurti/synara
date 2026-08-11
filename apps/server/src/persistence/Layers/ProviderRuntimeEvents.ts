import { NonNegativeInt, ProviderRuntimeEvent } from "@synara/contracts";
import { Effect, Layer, Schema } from "effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

import {
  PersistenceDecodeError,
  toPersistenceDecodeError,
  toPersistenceSqlError,
} from "../Errors.ts";
import {
  PROVIDER_RUNTIME_EVENT_MAX_BYTES,
  PROVIDER_RUNTIME_EVENT_RETAIN_ACCEPTED,
  ProviderRuntimeEventRepository,
  type PersistedProviderRuntimeEvent,
  type ProviderRuntimeEventRepositoryShape,
} from "../Services/ProviderRuntimeEvents.ts";

const ProviderRuntimeEventJson = Schema.fromJsonString(ProviderRuntimeEvent);
const encodeEvent = Schema.encodeEffect(ProviderRuntimeEventJson);
const decodeEvent = Schema.decodeUnknownEffect(ProviderRuntimeEventJson);

const StoredRowSchema = Schema.Struct({
  sequence: NonNegativeInt,
  eventJson: Schema.String,
});
const decodeStoredRow = Schema.decodeUnknownEffect(StoredRowSchema);

/**
 * Longest-prefix string truncation that never splits a UTF-8 code point.
 * Returns the whole string when it already fits.
 */
const truncateUtf8ToBytes = (value: string, maxBytes: number): string => {
  const encoded = Buffer.from(value, "utf8");
  if (encoded.byteLength <= maxBytes) return value;
  let prefixEnd = maxBytes;
  while (prefixEnd > 0 && ((encoded[prefixEnd] ?? 0) & 0xc0) === 0x80) {
    prefixEnd -= 1;
  }
  return encoded.subarray(0, prefixEnd).toString("utf8");
};

/** Marker embedded in event.raw so replay keeps the truncation forensics. */
export const PROVIDER_RUNTIME_EVENT_TRUNCATED_KEY = "synaraJournalTruncated" as const;

/**
 * Shrink an oversized runtime event until it fits the durable journal budget.
 *
 * The journal keeps a hard 2MB row budget; an oversized item (typically a Pi
 * tool result copied verbatim into payload.data) must still be journaled —
 * quarantining it strands the live item and surfaces a permanent-failure
 * warning even though the underlying stream is healthy. Structural string
 * leaves inside the payload are truncated first (largest wins); the event then
 * records the truncation inside event.raw, whose payload is Schema.Unknown and
 * therefore survives the journal round-trip untouched.
 */
export function truncateOversizeProviderRuntimeEvent(
  event: ProviderRuntimeEvent,
  originalBytes: number,
): ProviderRuntimeEvent {
  const forensics = {
    [PROVIDER_RUNTIME_EVENT_TRUNCATED_KEY]: {
      truncated: true,
      reason: "provider runtime event exceeded the durable journal size limit",
      originalBytes,
    },
  };

  const payload =
    event.payload !== null && typeof event.payload === "object"
      ? shrinkRecordStrings(event.payload as Record<string, unknown>)
      : event.payload;

  if (event.raw === undefined) {
    return {
      ...event,
      payload,
      raw: { source: inferRawSource(event.provider), payload: forensics },
    } as ProviderRuntimeEvent;
  }

  const rawPayload = event.raw.payload;
  const mergedRawPayload =
    rawPayload !== null && typeof rawPayload === "object"
      ? { ...(rawPayload as Record<string, unknown>), ...forensics }
      : { value: rawPayload, ...forensics };

  return {
    ...event,
    payload,
    raw: { ...event.raw, payload: mergedRawPayload },
  } as ProviderRuntimeEvent;
}

const inferRawSource = (provider: ProviderRuntimeEvent["provider"]) => {
  switch (provider) {
    case "claudeAgent":
      return "claude.sdk.message" as const;
    case "antigravity":
      return "antigravity.cli.event" as const;
    case "cursor":
      return "acp.cursor.extension" as const;
    case "kilo":
      return "kilo.sdk.event" as const;
    case "opencode":
      return "opencode.sdk.event" as const;
    default:
      return "codex.app-server.notification" as const;
  }
};

/** Budget assigned to every string leaf so the total stays well under 2MB. */
const JOURNAL_STRING_LEAF_BUDGET_BYTES = 64 * 1024;

const shrinkRecordStrings = (record: Record<string, unknown>): Record<string, unknown> => {
  const shrunk: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(record)) {
    if (typeof value === "string") {
      shrunk[key] = truncateUtf8ToBytes(value, JOURNAL_STRING_LEAF_BUDGET_BYTES);
    } else if (Array.isArray(value)) {
      shrunk[key] = value.map((item) =>
        typeof item === "string"
          ? truncateUtf8ToBytes(item, JOURNAL_STRING_LEAF_BUDGET_BYTES)
          : item !== null && typeof item === "object" && !Array.isArray(item)
            ? shrinkRecordStrings(item as Record<string, unknown>)
            : item,
      );
    } else if (value !== null && typeof value === "object") {
      shrunk[key] = shrinkRecordStrings(value as Record<string, unknown>);
    } else {
      shrunk[key] = value;
    }
  }
  return shrunk;
};

const make = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  const insertPersistedEvent = (
    originalEvent: ProviderRuntimeEvent,
    persistedEvent: ProviderRuntimeEvent,
    persistedEventJson: string,
  ) =>
    Effect.gen(function* () {
      const rows = yield* sql
        .withTransaction(
          Effect.gen(function* () {
            const existing = yield* sql<Record<string, unknown>>`
            SELECT sequence, event_json AS "eventJson"
            FROM provider_runtime_events
            WHERE event_id = ${originalEvent.eventId}
          `;
            if (existing.length > 0) return existing;
            return yield* sql<Record<string, unknown>>`
            INSERT INTO provider_runtime_events (
              event_id, thread_id, turn_id, lifecycle_generation, event_type,
              event_json, persisted_at
            ) VALUES (
              ${originalEvent.eventId}, ${originalEvent.threadId}, ${originalEvent.turnId ?? null},
              ${originalEvent.lifecycleGeneration ?? null},
              ${originalEvent.type}, ${persistedEventJson}, ${new Date().toISOString()}
            )
            RETURNING sequence, event_json AS "eventJson"
          `;
          }),
        )
        .pipe(Effect.mapError(toPersistenceSqlError("ProviderRuntimeEvent.append")));
      const row = yield* decodeStoredRow(rows[0]).pipe(
        Effect.mapError(toPersistenceDecodeError("ProviderRuntimeEvent.append.row")),
      );
      if (row.eventJson !== persistedEventJson) {
        return yield* new PersistenceDecodeError({
          operation: "ProviderRuntimeEvent.append",
          issue: `Provider event '${originalEvent.eventId}' was reused with different content.`,
        });
      }
      return {
        sequence: row.sequence,
        event: persistedEvent,
      } satisfies PersistedProviderRuntimeEvent;
    });

  const append: ProviderRuntimeEventRepositoryShape["append"] = (event) =>
    Effect.gen(function* () {
      const eventJson = yield* encodeEvent(event).pipe(
        Effect.mapError(toPersistenceDecodeError("ProviderRuntimeEvent.append.encode")),
      );
      const originalBytes = Buffer.byteLength(eventJson, "utf8");
      if (originalBytes > PROVIDER_RUNTIME_EVENT_MAX_BYTES) {
        const compacted = truncateOversizeProviderRuntimeEvent(event, originalBytes);
        const compactedJson = yield* encodeEvent(compacted).pipe(
          Effect.mapError(toPersistenceDecodeError("ProviderRuntimeEvent.append.compact")),
        );
        if (Buffer.byteLength(compactedJson, "utf8") > PROVIDER_RUNTIME_EVENT_MAX_BYTES) {
          return yield* new PersistenceDecodeError({
            operation: "ProviderRuntimeEvent.append",
            issue: `Provider runtime event exceeds ${PROVIDER_RUNTIME_EVENT_MAX_BYTES} bytes after payload truncation.`,
          });
        }
        return yield* insertPersistedEvent(event, compacted, compactedJson);
      }
      return yield* insertPersistedEvent(event, event, eventJson);
    });

  const getHighWaterSequence = sql<{ readonly highWaterSequence: number }>`
    SELECT COALESCE(MAX(sequence), 0) AS "highWaterSequence"
    FROM provider_runtime_events
  `.pipe(
    Effect.map((rows) => rows[0]?.highWaterSequence ?? 0),
    Effect.mapError(toPersistenceSqlError("ProviderRuntimeEvent.getHighWaterSequence")),
  );

  const readAfter: ProviderRuntimeEventRepositoryShape["readAfter"] = (input) => {
    const limit = Math.max(1, Math.min(1_000, Math.floor(input.limit)));
    return Effect.gen(function* () {
      const rows = yield* sql<Record<string, unknown>>`
        SELECT sequence, event_json AS "eventJson"
        FROM provider_runtime_events
        WHERE sequence > ${input.sequenceExclusive}
          AND sequence <= ${input.throughSequenceInclusive}
        ORDER BY sequence ASC
        LIMIT ${limit}
      `.pipe(Effect.mapError(toPersistenceSqlError("ProviderRuntimeEvent.readAfter")));
      return yield* Effect.forEach(
        rows,
        (unknownRow) =>
          Effect.gen(function* () {
            const row = yield* decodeStoredRow(unknownRow).pipe(
              Effect.mapError(toPersistenceDecodeError("ProviderRuntimeEvent.readAfter.row")),
            );
            const event = yield* decodeEvent(row.eventJson).pipe(
              Effect.mapError(
                toPersistenceDecodeError(
                  `ProviderRuntimeEvent.readAfter(sequence=${row.sequence})`,
                ),
              ),
            );
            return { sequence: row.sequence, event } satisfies PersistedProviderRuntimeEvent;
          }),
        { concurrency: 1 },
      );
    });
  };

  const readAcceptedOpenTurnEvents: ProviderRuntimeEventRepositoryShape["readAcceptedOpenTurnEvents"] =
    (input) => {
      const limit = Math.max(1, Math.min(1_000, Math.floor(input.limit)));
      return Effect.gen(function* () {
        const rows = yield* sql<Record<string, unknown>>`
          SELECT event.sequence, event.event_json AS "eventJson"
          FROM provider_runtime_events AS event
          INNER JOIN provider_runtime_open_turns AS open_turn
            ON open_turn.thread_id = event.thread_id
           AND open_turn.turn_id = event.turn_id
           AND event.sequence >= open_turn.first_sequence
          INNER JOIN provider_runtime_event_consumers AS consumer
            ON consumer.consumer_name = ${input.consumerName}
           AND event.sequence <= consumer.last_acked_sequence
          WHERE event.sequence > ${input.sequenceExclusive}
          ORDER BY event.sequence ASC
          LIMIT ${limit}
        `.pipe(
          Effect.mapError(toPersistenceSqlError("ProviderRuntimeEvent.readAcceptedOpenTurnEvents")),
        );
        return yield* Effect.forEach(
          rows,
          (unknownRow) =>
            Effect.gen(function* () {
              const row = yield* decodeStoredRow(unknownRow).pipe(
                Effect.mapError(
                  toPersistenceDecodeError("ProviderRuntimeEvent.readAcceptedOpenTurnEvents.row"),
                ),
              );
              const event = yield* decodeEvent(row.eventJson).pipe(
                Effect.mapError(
                  toPersistenceDecodeError(
                    `ProviderRuntimeEvent.readAcceptedOpenTurnEvents(sequence=${row.sequence})`,
                  ),
                ),
              );
              return { sequence: row.sequence, event } satisfies PersistedProviderRuntimeEvent;
            }),
          { concurrency: 1 },
        );
      });
    };

  const getConsumerCursor: ProviderRuntimeEventRepositoryShape["getConsumerCursor"] = (
    consumerName,
  ) =>
    sql<{ readonly lastAckedSequence: number }>`
        SELECT last_acked_sequence AS "lastAckedSequence"
        FROM provider_runtime_event_consumers
        WHERE consumer_name = ${consumerName}
      `.pipe(
      Effect.flatMap((rows) =>
        rows[0] === undefined
          ? Effect.fail(
              new PersistenceDecodeError({
                operation: "ProviderRuntimeEvent.getConsumerCursor",
                issue: `Consumer '${consumerName}' is not registered.`,
              }),
            )
          : Effect.succeed(rows[0].lastAckedSequence),
      ),
      Effect.mapError((error) =>
        error instanceof PersistenceDecodeError
          ? error
          : toPersistenceSqlError("ProviderRuntimeEvent.getConsumerCursor")(error),
      ),
    );

  const advanceConsumerCursor: ProviderRuntimeEventRepositoryShape["advanceConsumerCursor"] = (
    input,
  ) =>
    sql
      .withTransaction(
        Effect.gen(function* () {
          const consumerRows = yield* sql<{ readonly lastAckedSequence: number }>`
            SELECT last_acked_sequence AS "lastAckedSequence"
            FROM provider_runtime_event_consumers
            WHERE consumer_name = ${input.consumerName}
          `;
          const cursor = consumerRows[0]?.lastAckedSequence;
          if (cursor === undefined) return false;
          if (cursor >= input.eventSequence) return true;

          // Event ids are idempotent and SQLite may leave sequence gaps after a
          // conflicting insert. Contiguity therefore means the exact next
          // stored row, not arithmetic sequence + 1.
          const nextRows = yield* sql<{ readonly sequence: number | null }>`
            SELECT MIN(sequence) AS sequence
            FROM provider_runtime_events
            WHERE sequence > ${cursor}
          `;
          if (nextRows[0]?.sequence !== input.eventSequence) return false;

          const eventRows = yield* sql<{
            readonly eventType: string;
            readonly threadId: string;
            readonly turnId: string | null;
          }>`
            SELECT event_type AS "eventType", thread_id AS "threadId", turn_id AS "turnId"
            FROM provider_runtime_events
            WHERE sequence = ${input.eventSequence}
          `;
          const event = eventRows[0];
          if (!event) return false;

          const advanced = yield* sql<{ readonly sequence: number }>`
            UPDATE provider_runtime_event_consumers
            SET last_acked_sequence = ${input.eventSequence}, updated_at = ${input.updatedAt}
            WHERE consumer_name = ${input.consumerName}
              AND last_acked_sequence = ${cursor}
            RETURNING last_acked_sequence AS sequence
          `;
          if (advanced.length !== 1) return false;

          const isTerminalTurnEvent =
            event.eventType === "turn.completed" || event.eventType === "turn.aborted";
          const isThreadTerminalEvent =
            event.eventType === "session.exited" || event.eventType === "runtime.error";
          if (event.turnId !== null && !isTerminalTurnEvent && !isThreadTerminalEvent) {
            yield* sql`
              INSERT INTO provider_runtime_open_turns (
                thread_id, turn_id, first_sequence, updated_at
              ) VALUES (
                ${event.threadId}, ${event.turnId}, ${input.eventSequence}, ${input.updatedAt}
              )
              ON CONFLICT (thread_id, turn_id) DO UPDATE SET
                first_sequence = MIN(
                  provider_runtime_open_turns.first_sequence,
                  excluded.first_sequence
                ),
                updated_at = excluded.updated_at
            `;
          } else if (event.turnId !== null) {
            yield* sql`
              DELETE FROM provider_runtime_open_turns
              WHERE thread_id = ${event.threadId} AND turn_id = ${event.turnId}
            `;
          } else if (isThreadTerminalEvent) {
            yield* sql`
              DELETE FROM provider_runtime_open_turns
              WHERE thread_id = ${event.threadId}
            `;
          } else if (isTerminalTurnEvent) {
            yield* sql`
              DELETE FROM provider_runtime_open_turns
              WHERE thread_id = ${event.threadId}
                AND 1 = (
                  SELECT COUNT(*) FROM provider_runtime_open_turns
                  WHERE thread_id = ${event.threadId}
                )
            `;
          }

          // Pending rows are above the cursor. Accepted rows for an open turn
          // remain replayable until its terminal output is accepted; all other
          // accepted history is bounded to a diagnostic tail.
          yield* sql`
            DELETE FROM provider_runtime_events AS event
            WHERE event.sequence <= ${input.eventSequence}
              AND NOT EXISTS (
                SELECT 1
                FROM provider_runtime_open_turns AS open_turn
                WHERE open_turn.thread_id = event.thread_id
                  AND open_turn.turn_id = event.turn_id
                  AND event.sequence >= open_turn.first_sequence
              )
              AND event.sequence NOT IN (
                SELECT sequence
                FROM provider_runtime_events
                WHERE sequence <= ${input.eventSequence}
                ORDER BY sequence DESC
                LIMIT ${PROVIDER_RUNTIME_EVENT_RETAIN_ACCEPTED}
              )
          `;
          return true;
        }),
      )
      .pipe(Effect.mapError(toPersistenceSqlError("ProviderRuntimeEvent.advanceConsumerCursor")));

  return {
    append,
    getHighWaterSequence,
    readAfter,
    readAcceptedOpenTurnEvents,
    getConsumerCursor,
    advanceConsumerCursor,
  } satisfies ProviderRuntimeEventRepositoryShape;
});

export const ProviderRuntimeEventRepositoryLive = Layer.effect(
  ProviderRuntimeEventRepository,
  make,
);
