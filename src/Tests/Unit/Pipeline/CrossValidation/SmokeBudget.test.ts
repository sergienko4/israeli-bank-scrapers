/**
 * Guard for the E2E-smoke per-bank time budget.
 *
 * <p>WHY THIS EXISTS — the flat 180 s `SMOKE_TIMEOUT` silently broke every bank
 * that runs a PRE-LOGIN phase. PRE-LOGIN is pre-submit navigation (reveal the
 * login area, wait for the form to mount), and its probe ceilings live in
 * `PreLoginTimingConfig.ts` at 15 s each. Forensic `pipeline.log` captures put
 * HOME + PRE-LOGIN alone at 211 s (Amex), 221 s (Isracard) and 217 s (Max) —
 * over the whole budget before a single credential is ever submitted. The test
 * therefore died mid-navigation and never reached a login verdict, which reads
 * in CI as `Exceeded timeout of 180000 ms` with no scraper output at all.
 *
 * <p>These assertions turn that class of failure into a unit-test failure. The
 * PRE-LOGIN bank set is derived from the real pipeline descriptors rather than
 * hard-coded, so adding `.withPreLogin()` to a new bank fails here — at the
 * cheapest layer of the pyramid — instead of surfacing as an opaque smoke
 * timeout on a live run.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { ScraperErrorTypes } from '../../../../Scrapers/Base/ErrorTypes.js';
import ScraperError from '../../../../Scrapers/Base/ScraperError.js';
import PIPELINE_REGISTRY from '../../../../Scrapers/Pipeline/Banks/PipelineRegistry.js';
import { SMOKE_TIMEOUT } from '../../../Config/TestTimingConfig.js';
import { FAILED_LOGIN_TYPES, SMOKE_HEADROOM_WARN_RATIO } from '../../../E2eSmoke/Helpers.js';
import { SMOKE_BANKS, SMOKE_EXCLUDED_BANKS } from '../../../E2eSmoke/SmokeConfig.js';
import { makeMockOptions } from '../Infrastructure/MockFactories.js';

const PRE_LOGIN_PHASE = 'pre-login';
const REPO_ROOT = process.cwd();
const SUITE_PATH = join(REPO_ROOT, 'src/Tests/E2eSmoke/InvalidLogin.e2e-smoke.test.ts');

/**
 * Floor for a PRE-LOGIN bank's budget.
 *
 * <p>Derived from measurement, not preference: the worst observed HOME+PRE-LOGIN
 * cost is 221 s (Isracard) and the worst observed LOGIN cost is 43 s, giving a
 * ~264 s floor before any CI network-latency penalty. Anything at or below that
 * reproduces the original timeout, so the constant is pinned above it. This
 * stops a future "tidy-up" from trimming the budget back into the failure.
 */
const PRE_LOGIN_FLOOR_MS = 300_000;

type SmokeBank = (typeof SMOKE_BANKS)[number];

/**
 * Whether a bank is driven by the phase pipeline at all.
 *
 * <p>Three matrix banks (Mizrahi, Beyahad Bishvilha, Behatsdaa) are legacy
 * scrapers with no `PIPELINE_REGISTRY` entry. Their phase list is unknowable
 * here, so they must not be treated as "has no PRE-LOGIN" — that would assert a
 * budget claim this test has no evidence for.
 * @param bank - Smoke configuration entry.
 * @returns True when the bank has a pipeline descriptor.
 */
function isPipelineDriven(bank: SmokeBank): boolean {
  return Boolean(PIPELINE_REGISTRY[bank.companyId]);
}

/**
 * Resolve the phase names a bank's real pipeline descriptor declares.
 * @param companyId - Company whose pipeline factory to build.
 * @returns Ordered phase names, or an empty list when the bank has no pipeline.
 * @throws ScraperError when a registered factory fails to build, which would
 *   otherwise misreport the bank as PRE-LOGIN-free.
 */
function phaseNamesOf(companyId: SmokeBank['companyId']): readonly string[] {
  const factory = PIPELINE_REGISTRY[companyId];
  if (!factory) return [];
  const mockOptions = makeMockOptions();
  const built = factory(mockOptions);
  if (!built.success) {
    // Returning [] here would classify the bank as PRE-LOGIN-free and let a
    // future PRE-LOGIN bank skip the extended-budget check entirely — the
    // same silent-hole class this suite exists to close.
    throw new ScraperError(`Could not build pipeline descriptor for ${companyId}`);
  }
  return built.value.phases.map((phase): string => phase.name);
}

/**
 * Whether a bank's pipeline runs the pre-submit PRE-LOGIN navigation phase.
 * @param bank - Smoke configuration entry.
 * @returns True when the descriptor declares a `pre-login` phase.
 */
function hasPreLogin(bank: SmokeBank): boolean {
  const names = phaseNamesOf(bank.companyId);
  return names.includes(PRE_LOGIN_PHASE);
}

const PRE_LOGIN_BANKS = SMOKE_BANKS.filter(hasPreLogin);
const LEGACY_BANKS = SMOKE_BANKS.filter(bank => !isPipelineDriven(bank));
const FLAT_BUDGET_BANKS = SMOKE_BANKS.filter(bank => isPipelineDriven(bank) && !hasPreLogin(bank));

describe('smoke budget: banks that run a PRE-LOGIN phase', () => {
  it('the derived PRE-LOGIN set is non-empty (guards against a silent no-op)', () => {
    expect(PRE_LOGIN_BANKS.length).toBeGreaterThan(0);
  });

  it.each(PRE_LOGIN_BANKS)('$displayName declares a budget above the flat default', bank => {
    expect(bank.smokeTimeoutMs).toBeDefined();
    expect(bank.smokeTimeoutMs).toBeGreaterThan(SMOKE_TIMEOUT);
  });

  it.each(PRE_LOGIN_BANKS)('$displayName clears its measured HOME+PRE-LOGIN floor', bank => {
    expect(bank.smokeTimeoutMs).toBeGreaterThanOrEqual(PRE_LOGIN_FLOOR_MS);
  });
});

describe('smoke budget: banks with no PRE-LOGIN phase', () => {
  it.each(FLAT_BUDGET_BANKS)(
    '$displayName keeps the flat default (no unexplained budget)',
    bank => {
      expect(bank.smokeTimeoutMs).toBeUndefined();
    },
  );
});

describe('smoke budget: legacy non-pipeline banks', () => {
  it('are surfaced rather than silently treated as PRE-LOGIN-free', () => {
    const names = LEGACY_BANKS.map(bank => bank.companyId).sort();
    expect(names).toStrictEqual(['behatsdaa', 'beyahadBishvilha', 'mizrahi']);
  });
});

describe('smoke budget: the suite honours the per-bank value', () => {
  const source = readFileSync(SUITE_PATH, 'utf8');

  it('destructures smokeTimeoutMs from the bank config', () => {
    expect(source).toContain('smokeTimeoutMs');
  });

  it('falls back to SMOKE_TIMEOUT when a bank declares no budget', () => {
    expect(source).toContain('smokeTimeoutMs ?? SMOKE_TIMEOUT');
  });

  it('reports budget headroom for every cell', () => {
    // Without this the suite prints pass/fail only, so a cell running at 95 %
    // of budget is indistinguishable from one at 40 % — exactly how four cells
    // sat on the cliff while the matrix read "all green". Match the WHOLE call
    // expression: independent substring checks would still pass if only the
    // now-unused import survived, or if the budget argument were swapped for
    // the flat SMOKE_TIMEOUT while `budgetMs` lingered elsewhere in the file.
    expect(source).toMatch(
      /reportSmokeHeadroom\(\s*displayName,\s*Date\.now\(\) - startedAt,\s*budgetMs\s*\)/,
    );
  });
});

describe('smoke budget: headroom telemetry', () => {
  it('warns below the band that produced the observed failures', () => {
    // Otsar Hahayal and Pagi failed at 100 % and Massad ran at 95 %. The
    // threshold must fire inside that band, and low enough to give a run of
    // warning before the cell turns red.
    expect(SMOKE_HEADROOM_WARN_RATIO).toBeLessThan(0.92);
    expect(SMOKE_HEADROOM_WARN_RATIO).toBeGreaterThan(0.5);
  });

  it('leaves the healthiest measured cells unflagged', () => {
    // Hapoalim's measured peak is 116 s. Under the 300 s budget that is 39 %,
    // so a correct threshold must not annotate it.
    const hapoalimPeakMs = 116_000;
    const usedRatio = hapoalimPeakMs / SMOKE_TIMEOUT;
    expect(usedRatio).toBeLessThan(SMOKE_HEADROOM_WARN_RATIO);
  });

  it('gives the previously failing cells real headroom', () => {
    // Otsar Hahayal and Pagi were killed at 180 s. The new budget must leave
    // them comfortably inside the warn threshold, not merely inside the cap.
    const observedCeilingMs = 180_000;
    const usedRatio = observedCeilingMs / SMOKE_TIMEOUT;
    expect(usedRatio).toBeLessThan(SMOKE_HEADROOM_WARN_RATIO);
  });
});

describe('smoke budget: a timeout never scores as a pass', () => {
  it('excludes Timeout from the accepted failure types', () => {
    // The budgets only mean anything if a run that never reached a login
    // verdict fails. Accepting Timeout would let a raised budget convert a
    // hang into a green required gate — the silent-green mode these budgets
    // exist to remove. The narrowed annotation on FAILED_LOGIN_TYPES makes
    // adding it a compile error; this proves the runtime list agrees.
    expect(FAILED_LOGIN_TYPES).not.toContain(ScraperErrorTypes.Timeout);
  });

  it('accepts only outcomes that reached a real verdict', () => {
    // Pins the whole set: a future edit that quietly admits NetworkError or
    // AccountBlocked would also let an unreached-verdict run score green.
    const accepted = [...FAILED_LOGIN_TYPES].sort();
    const expected = [
      'CHANGE_PASSWORD',
      'GENERIC',
      'INVALID_PASSWORD',
      'TWO_FACTOR_RETRIEVER_MISSING',
      'UNKNOWN_ERROR',
      'WAF_BLOCKED',
    ].sort();
    expect(accepted).toStrictEqual(expected);
  });
});

describe('smoke coverage: every pipeline bank is covered or explicitly excluded', () => {
  const covered = new Set<string>(SMOKE_BANKS.map(bank => bank.companyId));
  const excluded = new Set(Object.keys(SMOKE_EXCLUDED_BANKS));
  const registryBanks = Object.keys(PIPELINE_REGISTRY);

  it.each(registryBanks)('%s is either smoke-covered or listed with a reason', companyId => {
    const isAccountedFor = covered.has(companyId) || excluded.has(companyId);
    expect(isAccountedFor).toBe(true);
  });

  it('never excludes a bank that is also in the matrix', () => {
    const both = [...excluded].filter(id => covered.has(id));
    expect(both).toStrictEqual([]);
  });

  it('gives every exclusion a non-empty justification', () => {
    const entries = Object.entries(SMOKE_EXCLUDED_BANKS);
    const blank = entries.filter(([, why]) => why.trim().length === 0);
    expect(blank).toStrictEqual([]);
  });
});
