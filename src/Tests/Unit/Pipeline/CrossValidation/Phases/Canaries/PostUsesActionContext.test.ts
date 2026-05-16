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
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE_URL = fileURLToPath(import.meta.url);
const PHASES_ROOT = path.join(path.dirname(HERE_URL), '..');
/** Names accepted as proof the post handler is threaded from ACTION. */
const PROOF_PARAM_NAMES: readonly string[] = ['preCtx', 'actionCtx', 'postInput'];
/** Pattern matching a function declaration named `run*Post`/`run*PostFinal`. */
const POST_FN_PATTERN =
  /^\s*(?:async\s+)?function\s+(run[A-Z][A-Za-z0-9]*?(?:Post|PostFinal))\s*\(([^)]*)\)/;

/** One canary hit. */
interface IDetachedPostHit {
  readonly file: string;
  readonly lineNumber: number;
  readonly fnName: string;
  readonly signature: string;
}

/**
 * Walk one directory entry and feed any TS file(s) into `out`,
 * recursing into subdirectories (but skipping `Canaries/`).
 *
 * @param dir - Parent directory.
 * @param entry - Directory entry to inspect.
 * @param out - Accumulator collecting absolute paths.
 */
function collectTsEntry(dir: string, entry: fs.Dirent, out: string[]): void {
  if (entry.name === 'Canaries') return;
  const abs = path.join(dir, entry.name);
  if (entry.isDirectory()) {
    out.push(...gatherTsFiles(abs));
    return;
  }
  if (entry.name.endsWith('.ts')) out.push(abs);
}

/**
 * Recursively gather *.ts files under a folder, skipping the
 * Canaries/ subfolder so the canary doesn't analyse itself.
 *
 * @param dir - Folder to walk.
 * @returns Absolute paths of `.ts` files.
 */
function gatherTsFiles(dir: string): readonly string[] {
  const out: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    collectTsEntry(dir, entry, out);
  }
  return out;
}

/**
 * Test whether one source line declares a detached POST/FINAL helper.
 *
 * @param raw - Raw source line.
 * @returns Tuple of [fnName, params] when the line matches, else null.
 */
function matchPostHelper(raw: string): readonly [string, string] | null {
  const match = POST_FN_PATTERN.exec(raw);
  if (!match) return null;
  return [match[1], match[2]];
}

/**
 * Inspect one file for detached POST/FINAL helpers.
 *
 * @param file - Path of the file being analysed.
 * @param source - File contents.
 * @returns All offending POST/FINAL helpers in this file.
 */
function findDetachedPostHelpers(file: string, source: string): readonly IDetachedPostHit[] {
  const hits: IDetachedPostHit[] = [];
  source.split('\n').forEach((raw, lineIndex): void => {
    const hit = inspectLineForDetachedPost({ file, lineIndex, raw });
    if (hit !== null) hits.push(hit);
  });
  return hits;
}

/**
 * Inspect one source line and return a canary hit if it declares a
 * detached POST/FINAL helper, else null.
 *
 * @param args - File path, zero-based line index, raw line text.
 * @returns Canary hit when the helper is detached, else null.
 */
function inspectLineForDetachedPost(args: IInspectArgs): IDetachedPostHit | null {
  const matched = matchPostHelper(args.raw);
  if (!matched) return null;
  const [fnName, params] = matched;
  if (PROOF_PARAM_NAMES.some((p): boolean => params.includes(p))) return null;
  return { file: args.file, lineNumber: args.lineIndex + 1, fnName, signature: args.raw.trim() };
}

/** Bundle for {@link inspectLineForDetachedPost}. */
interface IInspectArgs {
  readonly file: string;
  readonly lineIndex: number;
  readonly raw: string;
}

/**
 * Format one hit for the failure message.
 *
 * @param hit - Detected canary hit.
 * @returns Pretty-printed hit line.
 */
function formatHit(hit: IDetachedPostHit): string {
  return `  ${path.relative(PHASES_ROOT, hit.file)}:${String(hit.lineNumber)}  ${hit.fnName}`;
}

/**
 * Build the failure message body from a list of hits.
 *
 * @param hits - All detected canary hits.
 * @returns Formatted multi-line message describing the failure.
 */
function buildFailureMessage(hits: readonly IDetachedPostHit[]): string {
  return (
    `🚫 PHASE-H DEEP-FACTORY RULE: ${String(hits.length)} POST/FINAL helper(s) detached from ACTION.\n` +
    'Accept one of: preCtx, actionCtx, postInput. Merge ACTION diagnostics into the post-input.\n\n' +
    hits.map(formatHit).join('\n')
  );
}

/**
 * Walk Phases/* and assert no detached-POST helpers remain.
 */
function runCanary(): void {
  const files = gatherTsFiles(PHASES_ROOT);
  const hits = files.flatMap((f): readonly IDetachedPostHit[] =>
    findDetachedPostHelpers(f, fs.readFileSync(f, 'utf8')),
  );
  if (hits.length > 0) throw new Error(buildFailureMessage(hits));
  expect(hits.length).toBe(0);
}

describe('PHASE-H-CANARY — POST/FINAL helpers must thread ACTION-produced context', () => {
  it('every run*Post / run*PostFinal helper must accept preCtx / actionCtx / postInput', runCanary);
});
