/**
 * Handoff script cursor — the walk over a script's tokens that the
 * handoff walker and the branch skipper share: where it stands, the
 * User-Agent the branches test and the location targets found so far.
 */

import type { IScriptToken, ScriptTokenKind } from './RunStep.locationScriptLexer.js';

/** Deepest `if` nesting a handoff script may use. */
const MAX_IF_DEPTH = 4;

/** What a walk reads past the last token: it ends any statement. */
const END_TOKEN: IScriptToken = { kind: 'end', text: '', isLineStart: true };

/** A walk over one script's tokens. */
interface IScriptWalk {
  readonly tokens: readonly IScriptToken[];
  readonly userAgent: string;
  readonly targets: string[];
  at: number;
}

/**
 * The token `offset` places past the cursor.
 * @param walk - Script walk.
 * @param offset - How far past the cursor.
 * @returns The token, or the end token past the last one.
 */
function tokenAt(walk: IScriptWalk, offset = 0): IScriptToken {
  return walk.tokens.at(walk.at + offset) ?? END_TOKEN;
}

/**
 * Whether the walk stands past the last token.
 * @param walk - Script walk.
 * @returns True at the end of the script.
 */
function isEndAt(walk: IScriptWalk): boolean {
  const token = tokenAt(walk);
  return token.kind === 'end';
}

/**
 * Whether the token at the cursor is one punctuator.
 * @param walk - Script walk.
 * @param text - The punctuator.
 * @returns True when it is.
 */
function isPunctAt(walk: IScriptWalk, text: string): boolean {
  const token = tokenAt(walk);
  return token.kind === 'punct' && token.text === text;
}

/**
 * Whether the token at the cursor is one name.
 * @param walk - Script walk.
 * @param text - The name.
 * @returns True when it is.
 */
function isNameAt(walk: IScriptWalk, text: string): boolean {
  const token = tokenAt(walk);
  return token.kind === 'name' && token.text === text;
}

/**
 * Step past one punctuator when the cursor is on it.
 * @param walk - Script walk.
 * @param text - The punctuator.
 * @returns True when it was there.
 */
function takePunct(walk: IScriptWalk, text: string): boolean {
  if (!isPunctAt(walk, text)) return false;
  walk.at += 1;
  return true;
}

/**
 * Step past one name when the cursor is on it.
 * @param walk - Script walk.
 * @param text - The name.
 * @returns True when it was there.
 */
function takeName(walk: IScriptWalk, text: string): boolean {
  if (!isNameAt(walk, text)) return false;
  walk.at += 1;
  return true;
}

/**
 * Take the token at the cursor when it is of one kind.
 * @param walk - Script walk.
 * @param kind - The kind wanted.
 * @returns The token, or false when the cursor is on another kind.
 */
function takeToken(walk: IScriptWalk, kind: ScriptTokenKind): IScriptToken | false {
  const token = tokenAt(walk);
  if (token.kind !== kind) return false;
  walk.at += 1;
  return token;
}

export type { IScriptWalk };
export { isEndAt, isNameAt, isPunctAt, MAX_IF_DEPTH, takeName, takePunct, takeToken, tokenAt };
