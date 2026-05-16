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

import ScraperError from '../../../../../../Scrapers/Base/ScraperError.js';

const HERE_URL = fileURLToPath(import.meta.url);
const HERE_DIR = path.dirname(HERE_URL);
const PHASES_ROOT = path.join(HERE_DIR, '..');
/** Pattern matching a discarded-await call. */
const DROPPED_AWAIT_PATTERN = /^\s*await\s+run[A-Z][A-Za-z0-9]+Action\s*\(/;
/**
 * Marker comment that authorises ONE immediately-following discarded
 * await. Must explain why no IActionContext is available to thread
 * (e.g. ACTION returns a primitive).
 */
const CANARY_EXEMPT_MARKER = '// @canary-exempt: dropped-action-result';

/** One offending hit: file + line + offending source. */
interface IDroppedAwaitHit {
  readonly file: string;
  readonly lineNumber: number;
  readonly source: string;
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
 * Recursively gather *.ts files under a folder, skipping
 * Canaries/ so the canary doesn't analyse itself.
 *
 * @param dir - Folder to walk.
 * @returns Absolute paths of `.ts` files under `dir`.
 */
function gatherTsFiles(dir: string): readonly string[] {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  return entries.flatMap((entry): readonly string[] => tsFilesFromEntry(dir, entry));
}

/**
 * Walk back past contiguous `//` comments above `fromIndex` and
 * return true when the first non-comment line is the canary
 * exemption marker.
 *
 * @param lines - All lines from the source.
 * @param fromIndex - Zero-based index of the line being inspected.
 * @returns True when the line above is the canary exemption marker.
 */
function isExempted(lines: readonly string[], fromIndex: number): boolean {
  for (let cursor = fromIndex - 1; cursor >= 0; cursor -= 1) {
    const cursorLine = lines[cursor] ?? '';
    const trimmed = cursorLine.trim();
    if (trimmed === CANARY_EXEMPT_MARKER) return true;
    if (!trimmed.startsWith('//')) return false;
  }
  return false;
}

/**
 * Produce a single-element hit array if `raw` is a discarded await
 * AND no upstream {@link CANARY_EXEMPT_MARKER} authorises it, else
 * an empty array.
 *
 * @param file - Path of the file being analysed.
 * @param lines - All lines from the source.
 * @param lineIndex - Zero-based index of `raw` in `lines`.
 * @returns Zero- or one-element hit array.
 */
function hitsForLine(
  file: string,
  lines: readonly string[],
  lineIndex: number,
): readonly IDroppedAwaitHit[] {
  const raw = lines[lineIndex] ?? '';
  if (!DROPPED_AWAIT_PATTERN.test(raw)) return [];
  if (isExempted(lines, lineIndex)) return [];
  return [{ file, lineNumber: lineIndex + 1, source: raw.trim() }];
}

/**
 * Detect every discarded-await hit in one file source.
 *
 * @param file - Path of the file being analysed.
 * @param source - File contents.
 * @returns All hits in this file (honouring CANARY_EXEMPT_MARKER).
 */
function findDroppedAwaits(file: string, source: string): readonly IDroppedAwaitHit[] {
  const lines = source.split('\n');
  return lines.flatMap((_unused, lineIndex): readonly IDroppedAwaitHit[] =>
    hitsForLine(file, lines, lineIndex),
  );
}

/**
 * Format one hit for the failure message.
 *
 * @param hit - Detected canary hit.
 * @returns Pretty-printed hit line.
 */
function formatHit(hit: IDroppedAwaitHit): string {
  const relPath = path.relative(PHASES_ROOT, hit.file);
  return `  ${relPath}:${String(hit.lineNumber)}  ${hit.source}`;
}

/**
 * Build the failure message body from a list of hits.
 *
 * @param hits - All detected canary hits.
 * @returns Formatted multi-line message describing the failure.
 */
function buildFailureMessage(hits: readonly IDroppedAwaitHit[]): string {
  const formatted = hits.map(formatHit).join('\n');
  const header = `🚫 PHASE-H DEEP-FACTORY RULE: ${String(hits.length)} discarded \`await run*Action(...)\` call(s) found.\n`;
  const body =
    'Capture every Action result. Dropping it lets ACTION fail while POST/FINAL hides the failure.\n\n';
  return `${header}${body}${formatted}`;
}

/**
 * Walk Phases/* and assert no discarded-await hits remain.
 *
 * @returns True after the assertion passes.
 */
function runCanary(): boolean {
  const files = gatherTsFiles(PHASES_ROOT);
  const hits = files.flatMap((f): readonly IDroppedAwaitHit[] => {
    const source = fs.readFileSync(f, 'utf8');
    return findDroppedAwaits(f, source);
  });
  if (hits.length > 0) throw new ScraperError(buildFailureMessage(hits));
  expect(hits.length).toBe(0);
  return true;
}

describe('PHASE-H-CANARY — no discarded `await runXxxAction(...)` in deep factories', () => {
  it('every awaited Action call in Phases/* MUST capture its result', () => {
    const didPass = runCanary();
    expect(didPass).toBe(true);
  });
});
