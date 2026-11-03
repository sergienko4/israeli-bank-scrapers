/**
 * Handoff script statements — the plain statements a selected path may
 * hold: an assignment of one quoted URL to one of seven location targets, or
 * a call to one of three ignored functions whose arguments are skipped as a
 * balanced group, never read. A statement ends at `;`, at a line break, at
 * the end of the script or before a block's `}`.
 */

import {
  type IScriptWalk,
  isPunctAt,
  takePunct,
  takeToken,
  tokenAt,
} from './RunStep.locationScriptCursor.js';
import { decodeJsString } from './RunStep.locationScriptLexer.js';
import { skipGroup } from './RunStep.locationScriptSkip.js';

/** Walks the rest of a statement after its name chain. */
type ChainWalker = (walk: IScriptWalk) => boolean;

/** The name chains a handoff script may assign a URL to. */
const LOCATION_TARGETS: ReadonlySet<string> = new Set([
  'location',
  'window.location',
  'window.location.href',
  'document.location',
  'document.location.href',
  'top.location',
  'top.location.href',
]);

/** The calls a handoff script may make, arguments unread. */
const IGNORED_CALLS: ReadonlySet<string> = new Set([
  'sessionStorage.removeItem',
  'localStorage.removeItem',
  'console.log',
]);

/**
 * Step over a `.name` link at the cursor.
 * @param walk - Script walk.
 * @returns The link's name, or '' when no link stands there.
 */
function takeLink(walk: IScriptWalk): string {
  const next = tokenAt(walk, 1);
  if (!isPunctAt(walk, '.') || next.kind !== 'name') return '';
  walk.at += 2;
  return next.text;
}

/**
 * Read a `name(.name)*` chain at the cursor.
 * @param walk - Script walk.
 * @returns The dotted chain, or '' when the cursor is not on a name.
 */
function readChain(walk: IScriptWalk): string {
  const first = takeToken(walk, 'name');
  if (first === false) return '';
  const names = [first.text];
  for (let link = takeLink(walk); link !== ''; link = takeLink(walk)) names.push(link);
  return names.join('.');
}

/**
 * Walk `= '<url>'` after a location target, keeping the decoded URL.
 * @param walk - Script walk.
 * @returns False for anything but one quoted string with plain escapes.
 */
function walkAssignment(walk: IScriptWalk): boolean {
  if (!takePunct(walk, '=')) return false;
  const token = takeToken(walk, 'string');
  if (token === false) return false;
  const url = decodeJsString(token.text);
  if (url === false) return false;
  walk.targets.push(url);
  return true;
}

/**
 * Walk an ignored call's arguments without reading them.
 * @param walk - Script walk.
 * @returns False unless a balanced `( … )` follows.
 */
function walkIgnoredCall(walk: IScriptWalk): boolean {
  return isPunctAt(walk, '(') && skipGroup(walk);
}

/**
 * End a statement.
 * @param walk - Script walk.
 * @returns True after `;`, or before a line break, the end (which starts a
 * line) or a `}`.
 */
function endStatement(walk: IScriptWalk): boolean {
  if (takePunct(walk, ';')) return true;
  const token = tokenAt(walk);
  return token.isLineStart || isPunctAt(walk, '}');
}

/** Each statement's name chains and how the statement goes on. */
const CHAIN_WALKERS: readonly {
  readonly names: ReadonlySet<string>;
  readonly walk: ChainWalker;
}[] = [
  { names: LOCATION_TARGETS, walk: walkAssignment },
  { names: IGNORED_CALLS, walk: walkIgnoredCall },
];

/**
 * Walk one plain statement.
 * @param walk - Script walk.
 * @returns False for any chain or shape outside the grammar.
 */
function walkChain(walk: IScriptWalk): boolean {
  const chain = readChain(walk);
  const entry = CHAIN_WALKERS.find((walker): boolean => walker.names.has(chain));
  if (entry === undefined) return false;
  return entry.walk(walk) && endStatement(walk);
}

export default walkChain;
export { walkChain };
