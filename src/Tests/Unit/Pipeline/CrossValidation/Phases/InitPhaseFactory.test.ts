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

import { executeValidatePage } from '../../../../../Scrapers/Pipeline/Mediator/Init/InitActions.js';
import { buildInitPhaseContext } from './Fixtures/_makeInitPhaseContext.js';
import { loadPhaseFixture, type PhaseHBank } from './Fixtures/_makePhaseFixture.js';

/** Per-scenario row driven by the parameterised `it.each` below. */
interface IInitScenarioRow {
  readonly bank: PhaseHBank;
  readonly scenarioId: string;
  readonly initPostUrl: string;
}

/** Scenarios exercised — one row per bank, all last-good landing URLs. */
const SCENARIOS: readonly IInitScenarioRow[] = [
  {
    bank: 'hapoalim',
    scenarioId: 'last-good',
    initPostUrl: 'https://www.bankhapoalim.example/',
  },
  {
    bank: 'beinleumi',
    scenarioId: 'last-good',
    initPostUrl: 'https://www.beinleumi.example/',
  },
  {
    bank: 'discount',
    scenarioId: 'last-good',
    initPostUrl: 'https://www.discount.example/',
  },
  {
    bank: 'amex',
    scenarioId: 'last-good',
    initPostUrl: 'https://www.amex.example/',
  },
  {
    bank: 'isracard',
    scenarioId: 'last-good',
    initPostUrl: 'https://www.isracard.example/',
  },
  {
    bank: 'max',
    scenarioId: 'last-good',
    initPostUrl: 'https://www.max.example/',
  },
  {
    bank: 'visacal',
    scenarioId: 'last-good',
    initPostUrl: 'https://www.cal-online.example/',
  },
];

/**
 * Drive INIT.POST for one scenario row and assert the captured-shape
 * outcome.
 *
 * @param row - Scenario row (bank + scenarioId + URL).
 * @returns Resolved when assertions complete.
 */
async function runInitPostForRow(row: IInitScenarioRow): Promise<void> {
  const fixture = loadPhaseFixture(row.bank, `init/${row.scenarioId}`);
  const subject = buildInitPhaseContext({ initPostUrl: row.initPostUrl });
  const result = await executeValidatePage(subject.context);
  const shouldSucceed = fixture.meta.expected.initPostOutcome === 'success';
  expect(result.success).toBe(shouldSucceed);
}

describe('INIT-PHASE-FACTORY — Phase H per-bank POST contract', () => {
  it.each(SCENARIOS)('initPost_$bank_$scenarioId_ShouldAcceptLandingUrl', runInitPostForRow);
});
