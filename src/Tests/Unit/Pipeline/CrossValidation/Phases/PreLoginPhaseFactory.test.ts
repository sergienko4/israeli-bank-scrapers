/**
 * Phase H.T3c.3 — cross-bank PRE-LOGIN per-phase factory.
 *
 * <p>Drives every bank's PII-redacted captured PRE-LOGIN shape
 * through production {@link executeValidateForm} (POST) +
 * {@link executeSignalToLogin} (FINAL), asserting the two-stage
 * Procedure outcomes match the fixture's contract. Each row
 * consumes a dedicated `<bank>/pre-login/<scenarioId>.json`
 * fixture (locked plan H.T3c.3: "+ 7 PRE-LOGIN fixtures").
 *
 * <p>PRE-LOGIN POST contract (per
 * `PreLoginPhaseActions.ts:254-267`): succeeds when the password
 * field is visible after the reveal click (form-gate found). FINAL
 * succeeds when POST committed `loginAreaReady=true` — replayed
 * end-to-end so the test surfaces wiring regressions across the
 * two stages, not isolated assertion drift.
 */

import ScraperError from '../../../../../Scrapers/Base/ScraperError.js';
import {
  executeSignalToLogin,
  executeValidateForm,
} from '../../../../../Scrapers/Pipeline/Mediator/PreLogin/PreLoginPhaseActions.js';
import { loadPhaseFixture, type PhaseHBank } from './Fixtures/_makePhaseFixture.js';
import { buildPreLoginPhaseContext } from './Fixtures/_makePreLoginPhaseContext.js';

/** Per-scenario row driven by the parameterised `it.each` below. */
interface IPreLoginScenarioRow {
  readonly bank: PhaseHBank;
  readonly scenarioId: string;
  readonly loginUrl: string;
}

/** Scenarios exercised by the PRE-LOGIN factory — one per bank. */
const SCENARIOS: readonly IPreLoginScenarioRow[] = [
  {
    bank: 'hapoalim',
    scenarioId: 'last-good',
    loginUrl: 'https://login.bankhapoalim.example/ng-portals/auth/he/',
  },
  {
    bank: 'beinleumi',
    scenarioId: 'last-good',
    loginUrl: 'https://login.beinleumi.example/login',
  },
  {
    bank: 'discount',
    scenarioId: 'last-good',
    loginUrl: 'https://start.telebank.example/auth',
  },
  {
    bank: 'amex',
    scenarioId: 'last-good',
    loginUrl: 'https://digital.amex.example/login',
  },
  {
    bank: 'isracard',
    scenarioId: 'last-good',
    loginUrl: 'https://digital.isracard.example/personalarea/login',
  },
  {
    bank: 'max',
    scenarioId: 'last-good',
    loginUrl: 'https://www.max.example/login-page',
  },
  {
    bank: 'visacal',
    scenarioId: 'last-good',
    loginUrl: 'https://login.cal-online.example/Login',
  },
];

describe('PRE-LOGIN-PHASE-FACTORY — Phase H per-bank POST+FINAL contract', () => {
  it.each(SCENARIOS)(
    'preLogin_$bank_$scenarioId_ShouldValidateFormAndSignal',
    async (row): Promise<void> => {
      const fixture = loadPhaseFixture(row.bank, `pre-login/${row.scenarioId}`);
      const expected = fixture.meta.expected;
      const isFormGateFound = expected.preLoginPostFormGateFound ?? true;
      const subject = buildPreLoginPhaseContext({ isFormGateFound, loginUrl: row.loginUrl });
      if (!subject.context.mediator.has) {
        throw new ScraperError('PRE_LOGIN_FACTORY: mediator missing');
      }

      const postResult = await executeValidateForm(subject.context.mediator.value, subject.context);
      const shouldPostSucceed = expected.preLoginPostOutcome === 'success';
      expect(postResult.success).toBe(shouldPostSucceed);

      if (postResult.success) {
        const finalResult = executeSignalToLogin(postResult.value);
        const shouldFinalSucceed = expected.preLoginFinalOutcome === 'success';
        expect(finalResult.success).toBe(shouldFinalSucceed);
      }
    },
  );
});
