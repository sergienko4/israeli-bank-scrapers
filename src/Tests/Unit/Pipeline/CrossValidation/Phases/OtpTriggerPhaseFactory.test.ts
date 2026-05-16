/**
 * Phase H.T3c.5 — cross-bank OTP-TRIGGER per-phase factory.
 *
 * <p>Drives OTP-using banks through production
 * {@link executeTriggerPost} + {@link executeTriggerFinal} and asserts
 * `ctx.otpTrigger` commits the slim {@link IOtpTrigger} value with
 * `triggered=true` and the captured phone-hint. Each row consumes a
 * dedicated `<bank>/otp-trigger/<scenarioId>.json` fixture (locked
 * plan H.T3c.5: per-bank fixtures for banks that use OTP).
 *
 * <p>Scope: covers the 4 banks observed exercising OTP-TRIGGER in
 * captured runs — hapoalim, beinleumi, max, visacal. Discount uses
 * password-only login (no OTP-TRIGGER step). The amex/isracard
 * family also uses password-only at LOGIN (not OTP-TRIGGER) per
 * captured-run evidence under `C:/tmp/runs/pipeline/<bank>/`.
 */

import {
  executeTriggerFinal,
  executeTriggerPost,
} from '../../../../../Scrapers/Pipeline/Mediator/OtpTrigger/OtpTriggerPhaseActions.js';
import { buildOtpTriggerPhaseContext } from './Fixtures/_makeOtpTriggerPhaseContext.js';
import { loadPhaseFixture, type PhaseHBank } from './Fixtures/_makePhaseFixture.js';

/** Per-scenario row driven by the parameterised `it.each` below. */
interface IOtpTriggerScenarioRow {
  readonly bank: PhaseHBank;
  readonly scenarioId: string;
  readonly otpUrl: string;
  readonly phoneHint: string;
}

/** Scenarios exercised — OTP-using banks only. */
const SCENARIOS: readonly IOtpTriggerScenarioRow[] = [
  {
    bank: 'hapoalim',
    scenarioId: 'last-good',
    otpUrl: 'https://login.bankhapoalim.example/ng-portals/auth/he/otp',
    phoneHint: 'XXX-XXX-FAKE',
  },
  {
    bank: 'beinleumi',
    scenarioId: 'last-good',
    otpUrl: 'https://login.beinleumi.example/otp',
    phoneHint: 'XXX-XXX-FAKE',
  },
  {
    bank: 'max',
    scenarioId: 'last-good',
    otpUrl: 'https://www.max.example/otp-verify',
    phoneHint: 'XXX-XXX-FAKE',
  },
  {
    bank: 'visacal',
    scenarioId: 'last-good',
    otpUrl: 'https://login.cal-online.example/otp',
    phoneHint: 'XXX-XXX-FAKE',
  },
];

describe('OTP-TRIGGER-PHASE-FACTORY — Phase H per-bank POST+FINAL', () => {
  it.each(SCENARIOS)(
    'otpTrigger_$bank_$scenarioId_ShouldCommitOtpTriggerSnapshot',
    async (row): Promise<void> => {
      const fixture = loadPhaseFixture(row.bank, `otp-trigger/${row.scenarioId}`);
      const subject = buildOtpTriggerPhaseContext({
        phoneHint: row.phoneHint,
        otpUrl: row.otpUrl,
      });

      const postResult = await executeTriggerPost(subject.context);
      const shouldPostSucceed = fixture.meta.expected.otpTriggerFinalOutcome === 'success';
      expect(postResult.success).toBe(shouldPostSucceed);

      if (postResult.success) {
        const finalResult = await executeTriggerFinal(postResult.value);
        expect(finalResult.success).toBe(shouldPostSucceed);
        if (finalResult.success) {
          const shouldTrigger = fixture.meta.expected.otpTriggerFinalTriggered ?? true;
          const committedOtpTrigger = finalResult.value.otpTrigger;
          expect(committedOtpTrigger.has).toBe(shouldTrigger);
          if (committedOtpTrigger.has) {
            const committedSnapshot = committedOtpTrigger.value;
            expect(committedSnapshot.phoneHint).toBe(row.phoneHint);
          }
        }
      }
    },
  );
});
