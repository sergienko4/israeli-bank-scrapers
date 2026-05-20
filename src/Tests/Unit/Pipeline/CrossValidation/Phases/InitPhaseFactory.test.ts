/**
 * Phase H.T3c.1 — cross-bank INIT per-phase factory.
 *
 * <p>Drives every PHASE_H_BANK through production
 * {@link executeValidatePage} (INIT.POST) and asserts the
 * post-navigation URL contract succeeds for each bank's last-good
 * landing URL. Each row consumes a dedicated
 * `<bank>/init/<scenarioId>.json` fixture (locked plan H.T3c.1:
 * "+ 7 INIT fixtures").
 *
 * <p>INIT POST contract (`InitActions.ts:129-145`):
 * <ul>
 *   <li>Fails loud `INIT POST: no browser` when browser missing.</li>
 *   <li>Fails loud `INIT POST: page is blank` when URL ===
 *       `about:blank`.</li>
 *   <li>Fails loud `INIT POST: browser error page` when Firefox
 *       neterror probe fires.</li>
 *   <li>Succeeds otherwise — captured-shape last-good URLs pass.</li>
 * </ul>
 *
 * <p>INIT.PRE (browser launch) + INIT.FINAL (mediator wiring) are
 * heavily Playwright-dependent and exercised by live E2E tests; the
 * factory's scope is the POST URL contract that is unit-testable
 * cross-bank without spinning up a real browser.
 */

import ScraperError from '../../../../../Scrapers/Base/ScraperError.js';
import { executeValidatePage } from '../../../../../Scrapers/Pipeline/Mediator/Init/InitActions.js';
import { BANK_SCENARIOS, type IBankScenario } from './Fixtures/_BankScenarios.js';
import { buildInitPhaseContext } from './Fixtures/_makeInitPhaseContext.js';
import { loadPhaseFixture, type PhaseHBank } from './Fixtures/_makePhaseFixture.js';

/** Per-scenario row driven by the parameterised `it.each` below. */
interface IInitScenarioRow {
  readonly bank: PhaseHBank;
  readonly scenarioId: string;
  readonly initPostUrl: string;
}

/** Default fixture scenario id — single-source for every Phase H bank table. */
const DEFAULT_SCENARIO_ID = 'last-good';

/** Derive INIT scenarios from the shared {@link BANK_SCENARIOS} source. */
const SCENARIOS: readonly IInitScenarioRow[] = BANK_SCENARIOS.map(toInitRow);

/**
 * Map one {@link IBankScenario} to the local INIT row shape. INIT.POST
 * validates the bank's landing page, so the homepage URL from the
 * shared source IS the row's `initPostUrl`.
 *
 * @param row - Shared bank scenario row.
 * @returns Local INIT row.
 */
function toInitRow(row: IBankScenario): IInitScenarioRow {
  return { bank: row.bank, scenarioId: DEFAULT_SCENARIO_ID, initPostUrl: row.homepageUrl };
}

/**
 * Drive INIT.POST for one scenario row and assert the captured-shape
 * outcome.
 *
 * @param row - Scenario row (bank + scenarioId + URL).
 * @returns Resolved when assertions complete.
 */
async function runInitPostForRow(row: IInitScenarioRow): Promise<boolean> {
  const shouldSucceed = resolveExpectedInitOutcome(row);
  const subject = buildInitPhaseContext({ initPostUrl: row.initPostUrl });
  const result = await executeValidatePage(subject.context);
  expect(result.success).toBe(shouldSucceed);
  return true;
}

/**
 * Read the fixture's `initPostOutcome` and convert to boolean. Fails
 * fast (rabbit cycle #4 finding #5) when the optional field is absent.
 *
 * @param row - Scenario row.
 * @returns True when fixture expects success, false for failure path.
 * @throws {ScraperError} When the fixture lacks `initPostOutcome`.
 */
function resolveExpectedInitOutcome(row: IInitScenarioRow): boolean {
  const fixture = loadPhaseFixture(row.bank, `init/${row.scenarioId}`);
  const expectedOutcome = fixture.meta.expected.initPostOutcome;
  if (expectedOutcome === undefined) {
    throw new ScraperError(`INIT_FIXTURE_MISSING_initPostOutcome: ${row.bank}/${row.scenarioId}`);
  }
  return expectedOutcome === 'success';
}

describe('INIT-PHASE-FACTORY — Phase H per-bank POST contract', () => {
  it.each(SCENARIOS)('initPost_$bank_$scenarioId_ShouldAcceptLandingUrl', async row => {
    expect(row.scenarioId).toBeDefined();
    await runInitPostForRow(row);
  });
});
