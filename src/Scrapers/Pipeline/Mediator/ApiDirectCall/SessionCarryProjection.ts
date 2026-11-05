/**
 * Carry → session projection (N32) — the only path from a login's carry
 * snapshot to the scrape's session context. The ACTION stage applies it
 * after the first prime and the recovery hook after every recovery, so the
 * scrape never sees a slot outside the flow's `sessionCarry` allowlist.
 */

import type { JsonValue } from './Envelope/JsonPointer.js';

/** A login's carry snapshot, or the part of it handed to the scrape. */
type CarrySnapshot = Readonly<Record<string, JsonValue>>;

/**
 * Keep only the allowlisted slots the carry holds.
 * @param snapshot - The login's full carry snapshot.
 * @param allowlist - The flow's `sessionCarry`; absent passes the full snapshot.
 * @returns The scrape's session context.
 */
function projectSessionCarry(
  snapshot: CarrySnapshot,
  allowlist?: readonly string[],
): CarrySnapshot {
  if (allowlist === undefined) return snapshot;
  const held = allowlist.filter((slot): boolean => Object.hasOwn(snapshot, slot));
  const entries = held.map((slot): [string, JsonValue] => [slot, snapshot[slot]]);
  return Object.fromEntries(entries);
}

export default projectSessionCarry;

export { projectSessionCarry };
