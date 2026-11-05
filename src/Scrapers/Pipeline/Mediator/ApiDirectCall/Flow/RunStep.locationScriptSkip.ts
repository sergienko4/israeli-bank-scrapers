/**
 * Handoff branch skipper (N54) — steps over the branch the configured
 * User-Agent does not select without reading it: a block as one balanced
 * `( [ {` group, a nested `if` with its own `else` (so a dangling `else`
 * binds to the inner `if`, as in JS), any other statement up to its `;`, its
 * line break, or the closer of the group around it. A group that never
 * balances, or an `else` inside a statement, refuses the script.
 */

import {
  type IScriptWalk,
  isNameAt,
  isPunctAt,
  MAX_IF_DEPTH,
  takeName,
  tokenAt,
} from './RunStep.locationScriptCursor.js';
import type { IScriptToken } from './RunStep.locationScriptLexer.js';

/** What a skipped statement does with one token. */
type SkipMove = 'group' | 'stop' | 'end' | 'next' | 'bad';

const CLOSER_OF: ReadonlyMap<string, string> = new Map([
  ['(', ')'],
  ['[', ']'],
  ['{', '}'],
]);

const CLOSERS: ReadonlySet<string> = new Set(CLOSER_OF.values());

/** Moves of the punctuators that shape a statement; any other is `next`. */
const PUNCT_MOVES: ReadonlyMap<string, SkipMove> = new Map<string, SkipMove>([
  ['(', 'group'],
  ['[', 'group'],
  ['{', 'group'],
  [';', 'end'],
  [')', 'stop'],
  [']', 'stop'],
  ['}', 'stop'],
]);

/**
 * Read one token of a group, tracking the closers still owed.
 * @param walk - Script walk.
 * @param owed - Closers owed, innermost last.
 * @returns False at the end of the script or on a closer not owed.
 */
function groupStep(walk: IScriptWalk, owed: string[]): boolean {
  const token = tokenAt(walk);
  if (token.kind === 'end') return false;
  walk.at += 1;
  const text = token.kind === 'punct' ? token.text : '';
  const closer = CLOSER_OF.get(text);
  if (closer !== undefined) return owed.push(closer) > 0;
  return !CLOSERS.has(text) || owed.pop() === text;
}

/**
 * Step over a balanced group; the cursor must be on its opener.
 * @param walk - Script walk.
 * @returns False when the cursor is not on an opener or the group never balances.
 */
function skipGroup(walk: IScriptWalk): boolean {
  const opener = tokenAt(walk);
  if (opener.kind !== 'punct' || !CLOSER_OF.has(opener.text)) return false;
  const owed: string[] = [];
  let isOk = groupStep(walk, owed);
  while (isOk && owed.length > 0) isOk = groupStep(walk, owed);
  return isOk;
}

/**
 * What a statement does with a token, wherever it stands.
 * @param token - The token.
 * @returns `bad` for `else` or the end, the punctuator's own move, else `next`.
 */
function tokenMove(token: IScriptToken): SkipMove {
  if (token.kind === 'end') return 'bad';
  if (token.kind === 'name') return token.text === 'else' ? 'bad' : 'next';
  if (token.kind !== 'punct') return 'next';
  return PUNCT_MOVES.get(token.text) ?? 'next';
}

/**
 * What a skipped statement does with a token.
 * @param token - The token.
 * @param isFirst - Whether it is the statement's first token.
 * @returns The move: a group to step over, a stop before it, an end after it,
 * the next token, or a refusal. A later token starting a line stops it.
 */
function moveOf(token: IScriptToken, isFirst: boolean): SkipMove {
  if (!isFirst && token.isLineStart) return 'stop';
  const move = tokenMove(token);
  return isFirst && move === 'stop' ? 'bad' : move;
}

/**
 * Take one step through a skipped statement.
 * @param walk - Script walk.
 * @param isFirst - Whether the cursor is on the statement's first token.
 * @returns The move taken; `next` while the statement goes on.
 */
function skipStep(walk: IScriptWalk, isFirst: boolean): SkipMove {
  const token = tokenAt(walk);
  const move = moveOf(token, isFirst);
  if (move === 'group') return skipGroup(walk) ? 'next' : 'bad';
  if (move === 'next' || move === 'end') walk.at += 1;
  return move;
}

/**
 * Step over one statement that is neither a block nor an `if`.
 * @param walk - Script walk.
 * @returns False when it holds an unbalanced group or an `else`.
 */
function skipSingle(walk: IScriptWalk): boolean {
  let move = skipStep(walk, true);
  while (move === 'next') move = skipStep(walk, false);
  return move !== 'bad';
}

/**
 * Step over an `if` statement and its optional `else`.
 * @param walk - Script walk on the `if`.
 * @param depth - Its nesting depth.
 * @returns False past the nesting cap or on a malformed part.
 */
function skipIf(walk: IScriptWalk, depth: number): boolean {
  if (depth > MAX_IF_DEPTH) return false;
  walk.at += 1;
  if (!isPunctAt(walk, '(') || !skipGroup(walk)) return false;
  if (!skipBranch(walk, depth)) return false;
  if (!takeName(walk, 'else')) return true;
  return skipBranch(walk, depth);
}

/**
 * Step over the branch the User-Agent does not select.
 * @param walk - Script walk on the branch.
 * @param depth - Nesting depth of the `if` the branch belongs to.
 * @returns False when the branch is malformed.
 */
function skipBranch(walk: IScriptWalk, depth: number): boolean {
  if (isPunctAt(walk, '{')) return skipGroup(walk);
  if (isNameAt(walk, 'if')) return skipIf(walk, depth + 1);
  return skipSingle(walk);
}

export { skipBranch, skipGroup };
