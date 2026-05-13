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
const MIN_HOME_PRELUDE_TIMEOUT_MS = 15_000;

/** Minimum visible-text probe budget required for Hapoalim CI. */
const MIN_HOME_RESOLVER_ENTRY_TIMEOUT_MS = 20_000;

const THIS_FILE_PATH = fileURLToPath(import.meta.url);
const THIS_DIR = dirname(THIS_FILE_PATH);
const REPO_ROOT = join(THIS_DIR, '../../../../../../');
const HOME_RESOLVER_PATH = join(REPO_ROOT, 'src/Scrapers/Pipeline/Mediator/Home/HomeResolver.ts');

/**
 * Read the on-disk `HomeResolver.ts` source so the centralisation
 * invariant can be asserted without importing private internals.
 *
 * @returns Full file contents as UTF-8 text.
 */
function readHomeResolverSource(): string {
  return readFileSync(HOME_RESOLVER_PATH, 'utf8');
}

describe('TimingHomePreludeBudget', () => {
  it('[HOME-PRELUDE-BUDGET-001] HomePreludeBudget_TimingConfig_ShouldStayAboveCiRaceFloor', () => {
    expect(HOME_PRELUDE_TIMEOUT_MS).toBeGreaterThanOrEqual(MIN_HOME_PRELUDE_TIMEOUT_MS);
    expect(HOME_RESOLVER_ENTRY_TIMEOUT_MS).toBeGreaterThanOrEqual(
      MIN_HOME_RESOLVER_ENTRY_TIMEOUT_MS,
    );
  });

  it('[HOME-PRELUDE-BUDGET-002] HomeResolver_NoLocalEntryTimeout_ShouldImportFromTimingConfig', () => {
    const source = readHomeResolverSource();
    const hasTimingConfigImport = source.includes(
      "import { HOME_RESOLVER_ENTRY_TIMEOUT_MS } from '../Timing/TimingConfig.js'",
    );
    const hasLocalEntryTimeoutLiteral = /const\s+ENTRY_TIMEOUT\s*=/.test(source);
    expect(hasTimingConfigImport).toBe(true);
    expect(hasLocalEntryTimeoutLiteral).toBe(false);
  });
});
