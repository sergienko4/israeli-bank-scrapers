/**
 * Handoff script walker — follows the path the configured User-Agent
 * selects through a script's statements: plain statements (assignments and
 * ignored calls), and `if` on the User-Agent test, nested at most four deep,
 * whose taken branch, a block or one statement, is walked and whose other
 * branch is skipped unread. Anything else on the path refuses the script.
 */

import { readMarker } from './RunStep.locationScriptCondition.js';
import {
  type IScriptWalk,
  isEndAt,
  isNameAt,
  isPunctAt,
  MAX_IF_DEPTH,
  takeName,
  takePunct,
} from './RunStep.locationScriptCursor.js';
import type { IScriptToken } from './RunStep.locationScriptLexer.js';
import { skipBranch } from './RunStep.locationScriptSkip.js';
import { walkChain } from './RunStep.locationScriptStatement.js';

/** Walks or skips one branch. */
type BranchWalker = (walk: IScriptWalk, depth: number) => boolean;

/**
 * Whether the walk reached its closer, or the end of the script.
 * @param walk - Script walk.
 * @param closer - The punctuator that closes the list, '' for the end only.
 * @returns True on the closer or past the end.
 */
function isClosedAt(walk: IScriptWalk, closer: string): boolean {
  return isEndAt(walk) || isPunctAt(walk, closer);
}

/**
 * Walk statements up to a closer.
 * @param walk - Script walk.
 * @param depth - Nesting depth of the `if` around them, 0 at the top.
 * @param closer - The punctuator that closes the list, '' for the end only.
 * @returns False when a statement is refused.
 */
function walkUntil(walk: IScriptWalk, depth: number, closer: string): boolean {
  let isOk = true;
  while (isOk && !isClosedAt(walk, closer)) isOk = walkStatement(walk, depth);
  return isOk;
}

/**
 * Walk the selected branch: a block, or one statement.
 * @param walk - Script walk on the branch.
 * @param depth - Nesting depth of its `if`.
 * @returns False when the branch is refused.
 */
function walkBranch(walk: IScriptWalk, depth: number): boolean {
  if (!takePunct(walk, '{')) return walkStatement(walk, depth);
  return walkUntil(walk, depth, '}') && takePunct(walk, '}');
}

/**
 * How to go through a branch.
 * @param isTaken - Whether the User-Agent selects it.
 * @returns The walker for a taken branch, else the skipper.
 */
function branchOf(isTaken: boolean): BranchWalker {
  return isTaken ? walkBranch : skipBranch;
}

/**
 * Go through an `if`'s branch and its optional `else` branch.
 * @param walk - Script walk on the first branch.
 * @param depth - Nesting depth of the `if`.
 * @param isTaken - Whether the User-Agent selects the first branch.
 * @returns False when the selected branch is refused or a skipped one is malformed.
 */
function walkBranches(walk: IScriptWalk, depth: number, isTaken: boolean): boolean {
  if (!branchOf(isTaken)(walk, depth)) return false;
  if (!takeName(walk, 'else')) return true;
  return branchOf(!isTaken)(walk, depth);
}

/**
 * Walk an `if` on the User-Agent test.
 * @param walk - Script walk on the `if`.
 * @param depth - Its nesting depth, 1 at the top.
 * @returns False past the nesting cap, for another test or a refused branch.
 */
function walkIf(walk: IScriptWalk, depth: number): boolean {
  if (depth > MAX_IF_DEPTH) return false;
  walk.at += 1;
  const marker = readMarker(walk);
  if (marker === false) return false;
  const isTaken = walk.userAgent.includes(marker);
  return walkBranches(walk, depth, isTaken);
}

/**
 * Walk one statement on the selected path.
 * @param walk - Script walk.
 * @param depth - Nesting depth of the `if` around it, 0 at the top.
 * @returns False when it is refused.
 */
function walkStatement(walk: IScriptWalk, depth: number): boolean {
  if (isNameAt(walk, 'if')) return walkIf(walk, depth + 1);
  return walkChain(walk);
}

/**
 * The location targets a script assigns on the path a User-Agent selects.
 * @param tokens - The script's tokens.
 * @param userAgent - The User-Agent its tests read.
 * @returns The assigned URLs in order, or false when the script is refused.
 */
function selectedTargets(
  tokens: readonly IScriptToken[],
  userAgent: string,
): readonly string[] | false {
  const walk: IScriptWalk = { tokens, userAgent, targets: [], at: 0 };
  return walkUntil(walk, 0, '') && walk.targets;
}

export default selectedTargets;
export { selectedTargets };
