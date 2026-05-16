/**
 * Phase H.T3c.6 — cross-bank OTP-FILL per-phase factory.
 *
 * <p>Drives OTP-using banks through production
 * {@link executeFillPost} + {@link executeFillFinal} and asserts the
 * Procedure outcomes match each bank's captured-shape last-good
 * fixture. Each row consumes a dedicated
 * `<bank>/otp-fill/<scenarioId>.json` fixture (locked plan
 * H.T3c.6: per-bank fixtures for banks that use OTP).
 *
 * <p>Contract (`OtpFillPhaseActions.ts:309-347`):
 * <ul>
 *   <li>POST: succeeds when neither an OTP error nor the OTP form
 *       is still visible (mock-mediator's NOT_FOUND default matches
 *       the captured-shape "OTP accepted" state).</li>
 *   <li>FINAL: always succeeds — cookie count + URL are logged but
 *       never gate per design.</li>
 * </ul>
 *
 * <p>Scope: 4 OTP-using banks — hapoalim, beinleumi, max, visacal.
 * Amex/isracard/discount use password-only login (no OTP-FILL step).
 */

import {
  executeFillFinal,
  executeFillPost,
} from '../../../../../Scrapers/Pipeline/Mediator/OtpFill/OtpFillPhaseActions.js';
import { buildOtpFillPhaseContext } from './Fixtures/_makeOtpFillPhaseContext.js';
import { loadPhaseFixture, type PhaseHBank } from './Fixtures/_makePhaseFixture.js';

/** Per-scenario row driven by the parameterised `it.each` below. */
interface IOtpFillScenarioRow {
  readonly bank: PhaseHBank;
  readonly scenarioId: string;
  readonly dashboardUrl: string;
  readonly cookieCount: number;
}

/** Scenarios exercised — OTP-using banks only. */
const SCENARIOS: readonly IOtpFillScenarioRow[] = [
  {
    bank: 'hapoalim',
    scenarioId: 'last-good',
    dashboardUrl: 'https://login.bankhapoalim.example/ng-portals/dashboard',
    cookieCount: 4,
  },
  {
    bank: 'beinleumi',
    scenarioId: 'last-good',
    dashboardUrl: 'https://login.beinleumi.example/dashboard',
    cookieCount: 3,
  },
  {
    bank: 'max',
    scenarioId: 'last-good',
    dashboardUrl: 'https://www.max.example/account',
    cookieCount: 3,
  },
  {
    bank: 'visacal',
    scenarioId: 'last-good',
    dashboardUrl: 'https://login.cal-online.example/MainPage',
    cookieCount: 3,
  },
];

describe('OTP-FILL-PHASE-FACTORY — Phase H per-bank POST+FINAL', () => {
  it.each(SCENARIOS)(
    'otpFill_$bank_$scenarioId_ShouldValidatePostAndCommitFinal',
    async (row): Promise<void> => {
      const fixture = loadPhaseFixture(row.bank, `otp-fill/${row.scenarioId}`);
      const subject = buildOtpFillPhaseContext({
        cookieCount: row.cookieCount,
        dashboardUrl: row.dashboardUrl,
      });

      const postResult = await executeFillPost(subject.context);
      const shouldPostSucceed = fixture.meta.expected.otpFillPostOutcome === 'success';
      expect(postResult.success).toBe(shouldPostSucceed);

      if (postResult.success) {
        const finalResult = await executeFillFinal(postResult.value);
        const shouldFinalSucceed = fixture.meta.expected.otpFillFinalOutcome === 'success';
        expect(finalResult.success).toBe(shouldFinalSucceed);
      }
    },
  );
});
