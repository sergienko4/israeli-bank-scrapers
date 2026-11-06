/**
 * Handoff script condition — the one `if` test a handoff script may
 * use: `(navigator.userAgent.indexOf('<marker>') > -1)`, token for token,
 * with a quoted marker of 1 to 64 chars. Its branch is taken when the
 * configured User-Agent holds the marker.
 */

import { type IScriptWalk, tokenAt } from './RunStep.locationScriptCursor.js';
import { decodeJsString } from './RunStep.locationScriptLexer.js';

/** The marker's place in the condition; any other place holds one exact token. */
const MARKER_SLOT = '';
const CONDITION: readonly string[] = [
  '(',
  'navigator',
  '.',
  'userAgent',
  '.',
  'indexOf',
  '(',
  MARKER_SLOT,
  ')',
  '>',
  '-',
  '1',
  ')',
];
const MARKER_AT = CONDITION.indexOf(MARKER_SLOT);
const MAX_MARKER_CHARS = 64;

/**
 * Whether the token `offset` past the cursor fits its place in the condition.
 * @param walk - Script walk.
 * @param slot - The exact token wanted, or the marker slot.
 * @param offset - Its place.
 * @returns True for a quoted string in the marker slot, else the exact unquoted token.
 */
function fitsSlot(walk: IScriptWalk, slot: string, offset: number): boolean {
  const token = tokenAt(walk, offset);
  const isQuoted = token.kind === 'string' || token.kind === 'template';
  if (slot === MARKER_SLOT) return token.kind === 'string';
  return !isQuoted && token.text === slot;
}

/**
 * Read the condition at the cursor and step past it.
 * @param walk - Script walk on the `(` after `if`.
 * @returns Its marker, or false for any other condition or a marker out of bounds.
 */
function readMarker(walk: IScriptWalk): string | false {
  const isFit = CONDITION.every((slot, offset): boolean => fitsSlot(walk, slot, offset));
  if (!isFit) return false;
  const marker = decodeJsString(tokenAt(walk, MARKER_AT).text);
  walk.at += CONDITION.length;
  if (marker === false || marker.length > MAX_MARKER_CHARS) return false;
  return marker.length > 0 && marker;
}

export default readMarker;
export { readMarker };
