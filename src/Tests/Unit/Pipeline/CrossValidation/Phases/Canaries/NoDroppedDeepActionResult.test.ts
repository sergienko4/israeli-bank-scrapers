/**
 * Architectural canary (B3) — Phase H deep-factory rule:
 *
 * <p>Every `await run<Phase>Action(...)` call inside a per-phase
 * deep-factory test file MUST capture its result. Discarding the
 * boolean / IActionContext return lets the ACTION step fail
 * semantically while the test still passes through POST/FINAL,
 * which is exactly the regression CodeRabbit cycle #3 finding #4
 * surfaced for HOME.ACTION.
 *
 * <p>The canary scans every `*PhaseFactory.test.ts` and `FullFlow*.ts`
 * under `Phases/`, looking for the literal "discarded await" form
 * at line start (`^\s*await run<Anything>Action(...)`). Acceptable
 * forms are captured (`const x = await ...`) or returned
 * (`return runXxxAction(...)`).
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

/** Absolute path of this test file. */
const HERE_URL = fileURLToPath(import.meta.url);
/** Phases/ folder containing the deep-factory tests. */
const PHASES_ROOT = path.join(path.dirname(HERE_URL), '..');
/** Pattern matching a discarded-await call. */
const DROPPED_AWAIT_PATTERN = /^\s*await\s+run[A-Z][A-Za-z0-9]+Action\s*\(/;

/** One offending hit: file + line + offending source. */
interface IDroppedAwaitHit {
  readonly file: string;
  readonly lineNumber: number;
  readonly source: string;
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
 * Marker comment a deep-factory test file can place at line start
 * to opt out of {@link DROPPED_AWAIT_PATTERN}. Required when the
 * ACTION step returns a primitive (e.g. boolean) the chain
 * legitimately cannot thread through `mergeActionDiagnostics`.
 * Must include a documented reason.
 */
const CANARY_EXEMPT_MARKER = '// @canary-exempt: dropped-action-result';

/**
 * Detect the discarded-await pattern in a single source string.
 * Lines following a {@link CANARY_EXEMPT_MARKER} are skipped — the
 * marker authorises one immediately-following discarded await.
 *
 * @param file - Path of the file being analysed (for reporting).
 * @param source - File contents.
 * @returns All hits in this file.
 */
/** Bundle for {@link inspectLine}. */
interface IInspectArgs {
  readonly file: string;
  readonly lineIndex: number;
  readonly raw: string;
  readonly lines: readonly string[];
}

/**
 * Detect the discarded-await pattern across one source string.
 *
 * @param file - Path of the file being analysed.
 * @param source - File contents.
 * @returns All hits in this file (honouring CANARY_EXEMPT_MARKER).
 */
function findDroppedAwaits(file: string, source: string): readonly IDroppedAwaitHit[] {
  const hits: IDroppedAwaitHit[] = [];
  const lines = source.split('\n');
  lines.forEach((raw, lineIndex): void => {
    const hit = inspectLine({ file, lineIndex, raw, lines });
    if (hit !== null) hits.push(hit);
  });
  return hits;
}

/**
 * Walk back from `lineIndex - 1` past contiguous `//` comments and
 * return true when the first non-comment line above is exactly the
 * {@link CANARY_EXEMPT_MARKER}.
 *
 * @param lines - All lines from the source.
 * @param fromIndex - Index of the line being inspected.
 * @returns True if the await is preceded by the exemption marker
 *   (possibly with intervening comment-only lines explaining the
 *   exemption).
 */
function isExempted(lines: readonly string[], fromIndex: number): boolean {
  for (let cursor = fromIndex - 1; cursor >= 0; cursor -= 1) {
    const trimmed = lines[cursor]?.trim() ?? '';
    if (trimmed === CANARY_EXEMPT_MARKER) return true;
    if (!trimmed.startsWith('//')) return false;
  }
  return false;
}

/**
 * Inspect one source line for a discarded-await hit, honouring an
 * upstream {@link CANARY_EXEMPT_MARKER}.
 *
 * @param args - File path, zero-based line index, raw line text, and
 *   the full line array (used to detect the exemption marker).
 * @returns Canary hit or null.
 */
function inspectLine(args: IInspectArgs): IDroppedAwaitHit | null {
  if (!DROPPED_AWAIT_PATTERN.test(args.raw)) return null;
  if (isExempted(args.lines, args.lineIndex)) return null;
  return { file: args.file, lineNumber: args.lineIndex + 1, source: args.raw.trim() };
}

/**
 * Format one hit for the failure message.
 *
 * @param hit - Detected canary hit.
 * @returns Pretty-printed hit line.
 */
function formatHit(hit: IDroppedAwaitHit): string {
  return `  ${path.relative(PHASES_ROOT, hit.file)}:${String(hit.lineNumber)}  ${hit.source}`;
}

/**
 * Build the failure message body from a list of hits.
 *
 * @param hits - All detected canary hits.
 * @returns Formatted multi-line message describing the failure.
 */
function buildFailureMessage(hits: readonly IDroppedAwaitHit[]): string {
  const formatted = hits.map(formatHit).join('\n');
  return (
    `🚫 PHASE-H DEEP-FACTORY RULE: ${String(hits.length)} discarded \`await run*Action(...)\` call(s) found.\n` +
    'Capture every Action result. Dropping it lets ACTION fail while POST/FINAL hides the failure.\n\n' +
    formatted
  );
}

/**
 * Walk Phases/* and assert no discarded-await hits remain.
 */
function runCanary(): void {
  const files = gatherTsFiles(PHASES_ROOT).filter((f): boolean => f.endsWith('.ts'));
  const hits = files.flatMap((f): readonly IDroppedAwaitHit[] =>
    findDroppedAwaits(f, fs.readFileSync(f, 'utf8')),
  );
  if (hits.length > 0) throw new Error(buildFailureMessage(hits));
  expect(hits.length).toBe(0);
}

describe('PHASE-H-CANARY — no discarded `await runXxxAction(...)` in deep factories', () => {
  it('every awaited Action call in Phases/* MUST capture its result', runCanary);
});
