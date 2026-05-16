/**
 * Architectural canary (B4) — Phase H deep-factory rule:
 *
 * <p>In a deep PRE → ACTION → POST → FINAL chain, the POST step
 * MUST receive a context derived from the ACTION-produced state.
 * Switching POST onto an unrelated context (e.g. a separately-built
 * "form-gone" fixture) drops the ACTION commits from the chain and
 * lets state-handoff regressions slip through (CodeRabbit cycle #3
 * finding #5 against `OtpFillPhaseFactory`).
 *
 * <p>The canary enforces a syntactic contract: for every helper
 * matching `run*Post` or `run*PostFinal`, the parameter list MUST
 * include `preCtx`, `actionCtx`, or `postInput`. A `setup`-only
 * signature means POST/FINAL runs against a context detached from
 * PRE+ACTION.
 *
 * <p>Scans the FULL source with a multiline regex so multi-line
 * function signatures (produced by prettier on >120-char declarations)
 * are detected (CodeRabbit cycle #4 finding #2).
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

import ScraperError from '../../../../../../Scrapers/Base/ScraperError.js';

const HERE_URL = fileURLToPath(import.meta.url);
const HERE_DIR = path.dirname(HERE_URL);
const PHASES_ROOT = path.join(HERE_DIR, '..');
/** Names accepted as proof the post handler is threaded from ACTION. */
const PROOF_PARAM_NAMES: readonly string[] = ['preCtx', 'actionCtx', 'postInput'];
/**
 * Multiline pattern matching a `function run<X>Post(…)` declaration whose
 * parameter list may span multiple lines (after prettier reformatting).
 * The `[\s\S]*?` parameter group matches across newlines; the `g` flag
 * lets `matchAll` iterate the file. `PostFinal` is tried before `Post`
 * so the regex captures the full suffix.
 */
const POST_FN_PATTERN =
  /(?:^|\n)\s*(?:async\s+)?function\s+(run[A-Z][A-Za-z0-9]*?(?:PostFinal|Post))\s*\(([\s\S]*?)\)\s*[:{]/g;

/** One canary hit. */
interface IDetachedPostHit {
  readonly file: string;
  readonly lineNumber: number;
  readonly fnName: string;
  readonly signature: string;
}

/**
 * Inspect one directory entry and return any `.ts` files (recursing
 * into subdirectories, skipping `Canaries/`).
 *
 * @param dir - Parent directory of `entry`.
 * @param entry - Directory entry to inspect.
 * @returns Absolute paths discovered under `entry`.
 */
function tsFilesFromEntry(dir: string, entry: fs.Dirent): readonly string[] {
  if (entry.name === 'Canaries') return [];
  const abs = path.join(dir, entry.name);
  if (entry.isDirectory()) return gatherTsFiles(abs);
  return entry.name.endsWith('.ts') ? [abs] : [];
}

/**
 * Recursively gather *.ts files under a folder, skipping the
 * Canaries/ subfolder so the canary doesn't analyse itself.
 *
 * @param dir - Folder to walk.
 * @returns Absolute paths of `.ts` files under `dir`.
 */
function gatherTsFiles(dir: string): readonly string[] {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  return entries.flatMap((entry): readonly string[] => tsFilesFromEntry(dir, entry));
}

/**
 * Build zero or one canary hit(s) from a multi-line regex match.
 *
 * @param file - Path of the file being analysed.
 * @param source - File contents (used to compute line numbers).
 * @param match - One RegExp match returned by `matchAll`.
 * @returns Single-element hit array when the helper is detached, else empty.
 */
function hitsForMatch(
  file: string,
  source: string,
  match: RegExpMatchArray,
): readonly IDetachedPostHit[] {
  const [fullMatch, fnName, params] = match;
  if (PROOF_PARAM_NAMES.some((p): boolean => params.includes(p))) return [];
  const lineNumber = source.slice(0, match.index).split('\n').length;
  return [{ file, lineNumber, fnName, signature: fullMatch.trim() }];
}

/**
 * Scan one file's full source for detached POST/FINAL helpers,
 * including multi-line declarations.
 *
 * @param file - Path of the file being analysed.
 * @param source - File contents.
 * @returns All offending POST/FINAL helpers in this file.
 */
function findDetachedPostHelpers(file: string, source: string): readonly IDetachedPostHit[] {
  const matchIterator = source.matchAll(POST_FN_PATTERN);
  const matches = Array.from(matchIterator);
  return matches.flatMap((match): readonly IDetachedPostHit[] => hitsForMatch(file, source, match));
}

/**
 * Format one hit for the failure message.
 *
 * @param hit - Detected canary hit.
 * @returns Pretty-printed hit line.
 */
function formatHit(hit: IDetachedPostHit): string {
  const relPath = path.relative(PHASES_ROOT, hit.file);
  return `  ${relPath}:${String(hit.lineNumber)}  ${hit.fnName}`;
}

/**
 * Build the failure message body from a list of hits.
 *
 * @param hits - All detected canary hits.
 * @returns Formatted multi-line message describing the failure.
 */
function buildFailureMessage(hits: readonly IDetachedPostHit[]): string {
  const header = `🚫 PHASE-H DEEP-FACTORY RULE: ${String(hits.length)} POST/FINAL helper(s) detached from ACTION.\n`;
  const body =
    'Accept one of: preCtx, actionCtx, postInput. Merge ACTION diagnostics into the post-input.\n\n';
  return `${header}${body}${hits.map(formatHit).join('\n')}`;
}

/**
 * Walk Phases/* and assert no detached-POST helpers remain.
 *
 * @returns True after the assertion passes.
 */
function runCanary(): boolean {
  const files = gatherTsFiles(PHASES_ROOT);
  const hits = files.flatMap((f): readonly IDetachedPostHit[] => {
    const source = fs.readFileSync(f, 'utf8');
    return findDetachedPostHelpers(f, source);
  });
  if (hits.length > 0) throw new ScraperError(buildFailureMessage(hits));
  expect(hits.length).toBe(0);
  return true;
}

describe('PHASE-H-CANARY — POST/FINAL helpers must thread ACTION-produced context', () => {
  it('every run*Post / run*PostFinal helper must accept preCtx / actionCtx / postInput', () => {
    const didPass = runCanary();
    expect(didPass).toBe(true);
  });
});
