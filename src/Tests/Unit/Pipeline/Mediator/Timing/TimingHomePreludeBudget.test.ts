/**
 * Regression pins for the HOME wait-chain budgets owned by
 * `TimingConfig.ts`.
 *
 * <p>Background — I-3 surfaced 2026-05-13 on PR #227 / release PR #172
 * CI run: Hapoalim's `E2E Real` job intermittently failed (~73-82% pass
 * rate across 11 sampled runs) with `GENERIC HOME PRE: no login nav
 * link found` at ~43-45 s. Forensic check ruled out a code regression
 * (same signature on `b219f49b` before Phase E) and identified the
 * gap: HOME.PRE wait-chain = SPA prelude 10 s + visible-text probe
 * 15 s. Under throttled GitHub-runner bandwidth, Hapoalim's `load`
 * event occasionally exceeds 10 s because analytics scripts gate it;
 * the non-fatal prelude returns false; then the resolver scans a
 * half-hydrated DOM for the remaining 15 s and reports the canonical
 * "no login nav link found".
 *
 * <p>Fix (commit `fix(home): bump HOME prelude + resolver budgets`):
 * bump `HOME_PRELUDE_TIMEOUT_MS` 10 s → 15 s AND centralise the
 * previously-orphan literal in `HomeResolver.ts` as
 * `HOME_RESOLVER_ENTRY_TIMEOUT_MS = 20_000`. Banks that settle fast
 * early-exit the underlying `Promise.all([load, networkidle])` so the
 * bump is cross-bank safe.
 *
 * <p>Second bump 2026-05-31 (PR #281 C10) on top of the canonical-10
 * baseline: the I-3 race resurfaced 5/5 attempts because Hapoalim's
 * HOME.PRE wall on the GitHub Azure runner consistently exceeded the
 * 35 s joint budget. Local docker repro on the CI-mirror image
 * (`docker/Dockerfile.ci-mirror`, residential Israel IP) measured the
 * same wall at 31_532 ms — within the old budget but with zero
 * headroom. Bumped `HOME_PRELUDE_TIMEOUT_MS` 15_000 → 25_000 and
 * `HOME_RESOLVER_ENTRY_TIMEOUT_MS` 20_000 → 30_000; new joint budget
 * = 55 s per attempt absorbs the 20-30 s of CI bank-side overhead
 * over residential measurement.
 *
 * <p>This file pins both invariants so a future TIMING-mission cut
 * cannot silently re-introduce the race.
 */

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  HOME_PRELUDE_TIMEOUT_MS,
  HOME_RESOLVER_ENTRY_TIMEOUT_MS,
} from '../../../../../Scrapers/Pipeline/Mediator/Timing/TimingConfig.js';

/** Minimum SPA-prelude budget required to absorb Hapoalim CI `load` delay. */
const MIN_HOME_PRELUDE_TIMEOUT_MS = 25_000;

/** Minimum visible-text probe budget required for Hapoalim CI. */
const MIN_HOME_RESOLVER_ENTRY_TIMEOUT_MS = 30_000;

const THIS_FILE_PATH = fileURLToPath(import.meta.url);
const THIS_DIR = dirname(THIS_FILE_PATH);
const REPO_ROOT = join(THIS_DIR, '../../../../../../');
const HOME_RESOLVER_PATH = join(REPO_ROOT, 'src/Scrapers/Pipeline/Mediator/Home/HomeResolver.ts');
const HOME_RESOLVER_TRIGGER_PATH = join(
  REPO_ROOT,
  'src/Scrapers/Pipeline/Mediator/Home/HomeResolver.trigger.ts',
);

/**
 * Read the on-disk HOME resolver sources — the main `HomeResolver.ts`
 * plus the extracted `HomeResolver.trigger.ts`, which owns the
 * entry-timeout import after the Leumi real-href trigger split — so the
 * centralisation invariant holds wherever the import now lives.
 *
 * @returns Concatenated UTF-8 contents of both resolver files.
 */
function readHomeResolverSource(): string {
  const main = readFileSync(HOME_RESOLVER_PATH, 'utf8');
  const trigger = readFileSync(HOME_RESOLVER_TRIGGER_PATH, 'utf8');
  return `${main}\n${trigger}`;
}

/**
 * Structural detector for the `HOME_RESOLVER_ENTRY_TIMEOUT_MS`
 * import — tolerates multi-line import formatting, whitespace
 * variants, sibling named imports, and single- or double-quoted
 * specifiers. Anchored to the `Timing/TimingConfig.js` specifier
 * so an unrelated re-export from another module cannot accidentally
 * satisfy the centralisation invariant.
 *
 * <p>`[\s\S]` (not `.`) keeps the brace-balanced segment portable
 * across the lint rule that bans the `s` (dotAll) flag.
 */
const HOME_RESOLVER_ENTRY_TIMEOUT_IMPORT_REGEX =
  /import\s*\{[\s\S]*?\bHOME_RESOLVER_ENTRY_TIMEOUT_MS\b[\s\S]*?\}\s*from\s*['"][^'"]*Timing\/TimingConfig\.js['"]/;

describe('TimingHomePreludeBudget', () => {
  it('[HOME-PRELUDE-BUDGET-001] HomePreludeBudget_TimingConfig_ShouldStayAboveCiRaceFloor', () => {
    expect(HOME_PRELUDE_TIMEOUT_MS).toBeGreaterThanOrEqual(MIN_HOME_PRELUDE_TIMEOUT_MS);
    expect(HOME_RESOLVER_ENTRY_TIMEOUT_MS).toBeGreaterThanOrEqual(
      MIN_HOME_RESOLVER_ENTRY_TIMEOUT_MS,
    );
  });

  it('[HOME-PRELUDE-BUDGET-002] HomeResolver_NoLocalEntryTimeout_ShouldImportFromTimingConfig', () => {
    const source = readHomeResolverSource();
    const hasTimingConfigImport = HOME_RESOLVER_ENTRY_TIMEOUT_IMPORT_REGEX.test(source);
    const hasLocalEntryTimeoutLiteral = /const\s+ENTRY_TIMEOUT\s*=/.test(source);
    expect(hasTimingConfigImport).toBe(true);
    expect(hasLocalEntryTimeoutLiteral).toBe(false);
  });
});
