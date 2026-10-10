/**
 * Mizrahi scrape shape — row position. `get428Index` numbers its rows within
 * each reply (`RowNumber` from 1, `TotalRows` the reply's size), so a backfill
 * round re-serves a held movement under a new number. The window backfill
 * drops re-served rows by byte identity (RawOverlap), so a kept number would
 * file the movement twice. The extractor removes both keys; nothing
 * downstream reads them.
 */

import type { JsonUnknownRecord } from '../../../Types/JsonValue.js';

/** Keys that number a row within its reply, not the movement itself. */
const POSITIONAL_ROW_KEYS: ReadonlySet<string> = new Set(['RowNumber', 'TotalRows']);

/**
 * Whether a raw key numbers the row within its reply.
 * @param entry - Raw key/value pair.
 * @returns True for a positional key.
 */
function isPositional(entry: readonly [string, unknown]): boolean {
  const [key] = entry;
  return POSITIONAL_ROW_KEYS.has(key);
}

/**
 * A raw row without its reply-relative position, so the same movement reads
 * the same in every reply.
 * @param row - Raw get428Index row.
 * @returns The row without `RowNumber` / `TotalRows`.
 */
export default function withoutRowPosition(
  row: Readonly<JsonUnknownRecord>,
): Readonly<JsonUnknownRecord> {
  const kept = Object.entries(row).filter((entry): boolean => !isPositional(entry));
  return Object.fromEntries(kept);
}
