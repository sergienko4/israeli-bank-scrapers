/**
 * Awaited timers must be able to fire.
 *
 * <p>`{ ref: false }` tells Node "this timer must not keep the process
 * alive". That is correct for a fire-and-forget timer and a contradiction
 * for an awaited one: if the awaited timer is the only pending work, Node
 * empties the event loop and exits before it fires, so the `await` never
 * returns. The function does not throw, does not resolve, and does not log
 * — the process simply ends, exit code 0.
 *
 * <p>Issue #552 is that failure, shipped. A consumer's scrape returned
 * nothing at all: no result, no error, no diagnostic, and the actionable
 * message the launcher had already prepared was discarded on the way out.
 * Inside this repo the defect is invisible, because Jest, an open browser
 * or a live socket always keeps the loop busy enough for the timer to fire
 * anyway. It only appears when the library is the only thing running —
 * which is every consumer, and no CI job.
 *
 * <p>The four original offenders were all written the same way, so a
 * per-site fix would not have stopped the fifth. This scans the shipped
 * source instead. It bans the contradiction, not the flag: an unawaited
 * fire-and-forget timer may still legitimately unref itself.
 */

import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const THIS_FILE_PATH = fileURLToPath(import.meta.url);
const THIS_DIR = dirname(THIS_FILE_PATH);
const REPO_ROOT = join(THIS_DIR, '../../../../../');
const SHIPPED_SOURCE_DIR = join(REPO_ROOT, 'src/Scrapers');

/**
 * An `await` and a `ref: false` inside the same statement.
 *
 * <p>`[^;]+` is what makes this a statement-scoped match rather than a
 * file-scoped one: it cannot cross a `;`, so an awaited call on one line
 * and an unrelated unref'd timer on the next do not combine into a false
 * positive. The word boundary keeps `href: false` and friends out.
 */
const AWAITED_UNREF_TIMER = /await[^;]+\bref:\s*false/;

/** Extension of the TypeScript sources that end up in the published bundle. */
const SOURCE_EXTENSION = '.ts';

/**
 * List every shipped TypeScript source file.
 *
 * @returns Absolute paths of the files to scan.
 */
function listShippedSources(): readonly string[] {
  const entries = readdirSync(SHIPPED_SOURCE_DIR, { recursive: true, encoding: 'utf8' });
  const sources = entries.filter((entry): boolean => entry.endsWith(SOURCE_EXTENSION));
  return sources.map((entry): string => join(SHIPPED_SOURCE_DIR, entry));
}

/**
 * Report the file path relative to the repository root, so a failure
 * message names the offender the way a developer would.
 *
 * @param path - Absolute file path.
 * @returns Repository-relative path.
 */
function relativeTo(path: string): string {
  return path.slice(REPO_ROOT.length);
}

/**
 * Find every shipped source that awaits a timer it has told Node to ignore.
 *
 * @returns Repository-relative paths of the offenders.
 */
function findAwaitedUnrefTimers(): readonly string[] {
  const files = listShippedSources();
  const offenders = files.filter((file): boolean => {
    const source = readFileSync(file, 'utf8');
    return AWAITED_UNREF_TIMER.test(source);
  });
  return offenders.map(relativeTo);
}

describe('awaited timers', () => {
  it('[REF-1] no shipped source awaits a timer that cannot keep the process alive', () => {
    const offenders = findAwaitedUnrefTimers();
    expect(offenders).toEqual([]);
  });

  it('[REF-2] the scan actually recognises the contradiction it bans', () => {
    const contradiction = 'await setTimeoutPromise(ms, undefined, { ref: false });';
    const isDetected = AWAITED_UNREF_TIMER.test(contradiction);
    expect(isDetected).toBe(true);
  });

  it('[REF-3] a fire-and-forget unref\u2019d timer stays allowed', () => {
    const fireAndForget = 'const timer = setTimeoutPromise(ms, undefined, { ref: false });';
    const isDetected = AWAITED_UNREF_TIMER.test(fireAndForget);
    expect(isDetected).toBe(false);
  });

  it('[REF-4] an await in an earlier statement does not taint a later timer', () => {
    const unrelated = 'await work();\nconst timer = schedule({ ref: false });';
    const isDetected = AWAITED_UNREF_TIMER.test(unrelated);
    expect(isDetected).toBe(false);
  });
});
