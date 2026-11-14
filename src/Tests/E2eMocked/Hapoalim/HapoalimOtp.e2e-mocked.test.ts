/**
 * Hapoalim HTTP-only SMS step — mocked E2E for its edges: no retriever, a
 * wrong or malformed code, the bank refusing the code step, a missing or
 * unusable CSRF cookie, a pending answer without a flow field, and an
 * otp-init state other than the pending one. Each pins whether the caller was
 * asked for a code, and how far the run got.
 *
 * Rule #18: all credentials + data are synthetic; no real PII.
 */

import { ScraperErrorTypes } from '../../../Scrapers/Base/ErrorTypes.js';
import type { HapoalimFault } from './HapoalimFaults.js';
import { HP_BANK_NOTICE } from './HapoalimFaults.js';
import { HP_OTP, HP_PHONE } from './HapoalimMockData.js';
import type { IRunSetup } from './HapoalimRun.js';
import { LANDING_TRAIL, OTP_TRAIL, runHapoalim, VERIFY_TRAIL } from './HapoalimRun.js';

/** An SMS-step failure: the input, the failure, and what the run did first. */
interface IOtpRefusal {
  readonly name: string;
  readonly fault: HapoalimFault;
  readonly setup: IRunSetup;
  readonly errorType: ScraperErrorTypes;
  readonly message: string;
  readonly trail: readonly string[];
  readonly hints: readonly string[];
}

/** The run up to the SMS being sent, before any code goes back. */
const SENT_TRAIL = [...VERIFY_TRAIL, OTP_TRAIL[0]];

/** The run through the code going back. */
const ANSWERED_TRAIL = [...VERIFY_TRAIL, ...OTP_TRAIL];

const ASKED = [HP_PHONE];

const CSRF_BAD = 'ref cookie.csrfcookie bad';

const OTP_REFUSALS: readonly IOtpRefusal[] = [
  {
    name: 'no retriever',
    fault: 'none',
    setup: { otp: false },
    errorType: ScraperErrorTypes.TwoFactorRetrieverMissing,
    message: 'preHook: creds.otpCodeRetriever is not a function',
    trail: SENT_TRAIL,
    hints: [],
  },
  {
    name: 'a wrong code',
    fault: 'none',
    setup: { otp: '13579' },
    errorType: ScraperErrorTypes.InvalidOtp,
    message: 'otpVerify outcome unmapped',
    trail: ANSWERED_TRAIL,
    hints: ASKED,
  },
  {
    name: 'a 4-digit code, never sent',
    fault: 'none',
    setup: { otp: '1357' },
    errorType: ScraperErrorTypes.InvalidOtp,
    message: 'otpVerify preHook value invalid',
    trail: SENT_TRAIL,
    hints: ASKED,
  },
  {
    name: 'a locked answer to the code',
    fault: 'otpVerifyLocked',
    setup: {},
    errorType: ScraperErrorTypes.AccountBlocked,
    message: 'otpVerify outcome locked',
    trail: ANSWERED_TRAIL,
    hints: ASKED,
  },
  {
    name: 'a reissue answer to the code',
    fault: 'otpVerifyReissue',
    setup: {},
    errorType: ScraperErrorTypes.ChangePassword,
    message: 'otpVerify outcome reissue',
    trail: ANSWERED_TRAIL,
    hints: ASKED,
  },
  {
    name: 'a bank error on the code step',
    fault: 'otpVerifyErrors',
    setup: {},
    errorType: ScraperErrorTypes.Generic,
    message: 'otpVerify bank error',
    trail: ANSWERED_TRAIL,
    hints: ASKED,
  },
  {
    name: 'the login code reused for the device step-up',
    fault: 'newDevice',
    setup: { otp: [HP_OTP, HP_OTP] },
    errorType: ScraperErrorTypes.InvalidOtp,
    message: 'stepupVerify outcome unmapped',
    trail: [
      ...VERIFY_TRAIL,
      ...OTP_TRAIL,
      ...LANDING_TRAIL,
      'POST /arcotid/download',
      'POST /stepup/otp/init',
      'POST /stepup/otp/verify',
    ],
    hints: [HP_PHONE, HP_PHONE],
  },
  {
    name: 'no csrfcookie',
    fault: 'noCsrf',
    setup: {},
    errorType: ScraperErrorTypes.Generic,
    message: 'ref cookie.csrfcookie miss',
    trail: SENT_TRAIL,
    hints: [],
  },
  {
    name: 'a csrfcookie with a malformed escape',
    fault: 'csrfBadEscape',
    setup: {},
    errorType: ScraperErrorTypes.Generic,
    message: CSRF_BAD,
    trail: SENT_TRAIL,
    hints: [],
  },
  {
    name: 'a 4097-char csrfcookie',
    fault: 'csrfLong',
    setup: {},
    errorType: ScraperErrorTypes.Generic,
    message: CSRF_BAD,
    trail: SENT_TRAIL,
    hints: [],
  },
  ...(['otpInitStateOther', 'otpInitStateObject', 'otpInitStateNumber'] as const).map(fault => ({
    name: `an otp-init ${fault}`,
    fault,
    setup: {},
    errorType: ScraperErrorTypes.Generic,
    message: 'otpInit extract initState invalid',
    trail: SENT_TRAIL,
    hints: [],
  })),
];

describe('Hapoalim browserless SMS step', () => {
  it('asks twice on a new device: login OTP then the device step-up', async () => {
    const run = await runHapoalim('newDevice');
    expect(run.result.success).toBe(true);
    expect(run.hints).toEqual([HP_PHONE, HP_PHONE]);
    expect(run.trail).toContain('POST /stepup/otp/init');
    expect(run.trail).toContain('POST /stepup/otp/verify');
    expect(run.trail).toContain('POST /arcotid/download');
  });

  it('asks once on a registered device and skips the step-up', async () => {
    const run = await runHapoalim();
    expect(run.result.success).toBe(true);
    expect(run.hints).toEqual([HP_PHONE]);
    expect(run.trail).not.toContain('POST /stepup/otp/init');
    expect(run.trail).not.toContain('POST /arcotid/download');
  });

  it('does not read a flow field from verify: the OTP form sends the literal', async () => {
    const run = await runHapoalim('noFlow');
    expect(run.result.success).toBe(true);
    expect(run.hints).toEqual([HP_PHONE]);
  });

  it.each(OTP_REFUSALS)('fails $name', async refusal => {
    const run = await runHapoalim(refusal.fault, refusal.setup);
    expect(run.result.success).toBe(false);
    expect(run.result.errorType).toBe(refusal.errorType);
    expect(run.result.errorMessage).toBe(refusal.message);
    expect(run.result.errorMessage).not.toContain(HP_BANK_NOTICE);
    expect(run.trail).toEqual(refusal.trail);
    expect(run.hints).toEqual(refusal.hints);
  });
});
