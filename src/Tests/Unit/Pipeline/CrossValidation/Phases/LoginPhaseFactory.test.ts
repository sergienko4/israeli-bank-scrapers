/**
 * Phase H.T3c.4 — cross-bank LOGIN per-phase factory.
 *
 * <p>Drives every bank's PII-redacted captured LOGIN.FINAL cookie
 * snapshot through production {@link executeLoginSignal} and asserts
 * the cookie audit's Procedure outcome matches the fixture's
 * `expected.loginFinalOutcome` plus the captured cookie count meets
 * `expected.loginFinalMinCookieCount`.
 *
 * <p>Scope (locked 2026-05-16): LOGIN.FINAL cookie-audit replay only.
 * LOGIN.PRE + LOGIN.ACTION are heavily DOM-driven and the captured
 * runs under `C:/tmp/runs/pipeline/` carry only `network/` data — DOM
 * snapshots are intentionally not committed (PII risk). M2.T10's
 * synthetic LOGIN factory covers the PRE/ACTION action-handler logic
 * with bank-agnostic mocks; this factory adds per-bank captured-
 * shape integration coverage for FINAL.
 *
 * <p>Per `testing-organization-guidlines.md` "integration tests over
 * unit tests, unit tests for edge cases only" — this is the
 * integration tier; M2.T10 is the unit/isolation tier. Both layers
 * are kept.
 *
 * <p>Fixtures land incrementally one bank per commit (H.T3c.4a..g),
 * each replacing the placeholder marker so the regression guard
 * grows monotonically. The first scenario (`hapoalim` / `last-good`)
 * ships with this commit as the proof-of-shape.
 */

import type { ICookieSnapshot } from '../../../../../Scrapers/Pipeline/Mediator/Elements/ElementMediator.js';
import { executeLoginSignal } from '../../../../../Scrapers/Pipeline/Mediator/Login/LoginPhaseActions.js';
import {
  buildLoginPhaseContext,
  loadLoginFixtureCookies,
} from './Fixtures/_makeLoginPhaseContext.js';
import {
  type IPhaseHFixture,
  loadPhaseFixture,
  type PhaseHBank,
} from './Fixtures/_makePhaseFixture.js';

/** Per-scenario row driven by the parameterised `it.each` below. */
interface ILoginScenarioRow {
  readonly bank: PhaseHBank;
  readonly scenarioId: string;
}

/** Setup result for a single LOGIN.FINAL test row. */
interface ILoginTestSetup {
  readonly fixture: IPhaseHFixture;
  readonly cookies: readonly ICookieSnapshot[];
}

/**
 * Scenarios exercised by the LOGIN.FINAL factory. One row per
 * PHASE_H_BANK; each row consumes its own captured-cookies fixture.
 */
const SCENARIOS: readonly ILoginScenarioRow[] = [
  { bank: 'hapoalim', scenarioId: 'last-good' },
  { bank: 'beinleumi', scenarioId: 'last-good' },
  { bank: 'discount', scenarioId: 'last-good' },
  { bank: 'amex', scenarioId: 'last-good' },
  { bank: 'isracard', scenarioId: 'last-good' },
  { bank: 'max', scenarioId: 'last-good' },
  { bank: 'visacal', scenarioId: 'last-good' },
];

/**
 * Load a bank's LOGIN.FINAL fixture + its redacted cookie sidecar.
 *
 * @param row - Scenario row identifying bank + scenario id.
 * @returns Bundle of fixture metadata + cookie snapshot.
 */
function prepareLoginSetup(row: ILoginScenarioRow): ILoginTestSetup {
  const fixture = loadPhaseFixture(row.bank, `login/${row.scenarioId}`);
  const cookies = loadLoginFixtureCookies(row.bank, row.scenarioId);
  return { fixture, cookies };
}

/**
 * Drive {@link executeLoginSignal} against the setup and assert
 * the success outcome + cookie-count lower bound from the fixture.
 *
 * @param setup - Fixture + cookies bundle.
 * @returns Resolved when assertions complete.
 */
async function assertLoginOutcome(setup: ILoginTestSetup): Promise<void> {
  const context = buildLoginPhaseContext(setup.fixture, setup.cookies);
  const result = await executeLoginSignal(context);
  const shouldSucceed = setup.fixture.meta.expected.loginFinalOutcome === 'success';
  expect(result.success).toBe(shouldSucceed);
  const minCount = setup.fixture.meta.expected.loginFinalMinCookieCount;
  if (minCount !== undefined) {
    expect(setup.cookies.length).toBeGreaterThanOrEqual(minCount);
  }
}

describe('LOGIN-PHASE-FACTORY — Phase H per-bank LOGIN.FINAL contract', () => {
  it.each(SCENARIOS)(
    'loginFinal_$bank_$scenarioId_ShouldMatchCookieAuditOutcome',
    async (row): Promise<void> => {
      const setup = prepareLoginSetup(row);
      await assertLoginOutcome(setup);
    },
  );
});
