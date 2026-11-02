/**
 * Beinleumi browserless SMS step — mocked E2E. When the password answer
 * offers an SMS code the run asks the caller for it: a `generate` offer is
 * triggered first (and the trigger's answer names the code's real length), a
 * `validate` offer is asserted straight away. A fresh session id the bank
 * issues mid-flow is the one every later assertion names. A code of the
 * wrong length is never sent; an offer the run cannot take sends no SMS.
 *
 * Rule #18: all credentials + data are synthetic; no real PII.
 */

import { ScraperErrorTypes } from '../../../Scrapers/Base/ErrorTypes.js';
import type { OtpFault } from './BeinleumiFaults.js';
import { BN_FRESH_SID, BN_OFFERED_OTP_LENGTH, BN_OTP, BN_SID } from './BeinleumiMockData.js';
import type { IBeinleumiRun } from './BeinleumiRun.js';
import {
  OPENING_TRAIL,
  OTP_TRAIL,
  PORTAL_TRAIL,
  runBeinleumi,
  SCRAPE_TRAIL,
} from './BeinleumiRun.js';
import { WIRE_PATHS } from './BeinleumiWireSpec.js';

/** A run the bank asks a triggered code of, end to end. */
const GENERATE_TRAIL = [...OPENING_TRAIL, ...OTP_TRAIL, ...PORTAL_TRAIL, ...SCRAPE_TRAIL];

/** A run whose code the bank already sent, end to end. */
const VALIDATE_TRAIL = [...OPENING_TRAIL, 'assertOtp', ...PORTAL_TRAIL, ...SCRAPE_TRAIL];

/** A run the bank asks a triggered code of, up to the SMS trigger. */
const TRIGGERED_TRAIL = [...OPENING_TRAIL, 'otpInit'];

/** A code of the length the offer named, not the one the trigger answered. */
const OFFERED_LENGTH_CODE = BN_OTP.slice(0, BN_OFFERED_OTP_LENGTH);

/**
 * The session id each assertion named, in order.
 * @param run - The run.
 * @returns One `sid` per assert call.
 */
function sidsOf(run: IBeinleumiRun): readonly string[] {
  const asserts = run.calls.filter(call => new URL(call.url).pathname === WIRE_PATHS.assert);
  return asserts.map(call => new URL(call.url).searchParams.get('sid') ?? '');
}

/**
 * Expect a run to have signed in and scraped, every call on spec.
 * @param run - The run.
 * @param trail - The calls it must have made.
 * @returns True once checked.
 */
function expectSignedIn(run: IBeinleumiRun, trail: readonly string[]): boolean {
  expect(run.state.violations).toEqual([]);
  expect(run.result.errorMessage).toBeUndefined();
  expect(run.result.success).toBe(true);
  expect(run.trail).toEqual(trail);
  return true;
}

describe('Beinleumi browserless SMS step', () => {
  it.each([
    { fault: 'otpGenerate', trail: GENERATE_TRAIL },
    { fault: 'otpValidate', trail: VALIDATE_TRAIL },
  ] as const)(
    'signs in through the $fault offer, asking the caller once',
    async ({ fault, trail }) => {
      const run = await runBeinleumi(fault);
      expectSignedIn(run, trail);
      expect(run.hints).toEqual(['']);
      expect(run.launches).toBe(0);
    },
  );

  it('takes the code length from the trigger answer over the offer', async () => {
    const run = await runBeinleumi('otpGenerate', { otp: OFFERED_LENGTH_CODE });
    expect(run.result.errorType).toBe(ScraperErrorTypes.InvalidOtp);
    expect(run.trail).toEqual(TRIGGERED_TRAIL);
  });

  it('names the session id the bank refreshed mid-flow on every later assertion', async () => {
    const run = await runBeinleumi('otpSidRefresh');
    expectSignedIn(run, GENERATE_TRAIL);
    const sids = sidsOf(run);
    expect(sids).toEqual([BN_SID, BN_FRESH_SID, BN_FRESH_SID]);
  });

  it('asks a retriever handed only in the options', async () => {
    const run = await runBeinleumi('otpGenerate', { retrieverIn: 'options' });
    expectSignedIn(run, GENERATE_TRAIL);
    expect(run.hints).toEqual(['']);
  });

  it('fails a wrong code as an invalid code, posting no login form', async () => {
    const run = await runBeinleumi('otpGenerate', { otp: '13572468' });
    expect(run.state.violations).toEqual([]);
    expect(run.result).toMatchObject({ success: false, errorType: ScraperErrorTypes.InvalidOtp });
    expect(run.result.errorMessage).toContain('assertOtp bank error');
    expect(run.trail).toEqual([...OPENING_TRAIL, ...OTP_TRAIL]);
  });

  it.each([
    { fault: 'otpGenerate', trail: TRIGGERED_TRAIL },
    { fault: 'otpValidate', trail: OPENING_TRAIL },
  ] as const)(
    'never sends a code of the wrong length on the $fault offer',
    async ({ fault, trail }) => {
      const run = await runBeinleumi(fault, { otp: '1357' });
      expect(run.state.violations).toEqual([]);
      expect(run.result.errorType).toBe(ScraperErrorTypes.InvalidOtp);
      expect(run.result.errorMessage).toContain('assertOtp preHook value invalid');
      expect(run.trail).toEqual(trail);
    },
  );

  it('fails without a retriever when the bank asks for a code', async () => {
    const run = await runBeinleumi('otpGenerate', { otp: false });
    expect(run.state.violations).toEqual([]);
    expect(run.result.errorType).toBe(ScraperErrorTypes.TwoFactorRetrieverMissing);
    expect(run.trail).toEqual(TRIGGERED_TRAIL);
  });

  it.each(['otpVoiceOnly', 'otpAlphaFormat'] satisfies readonly OtpFault[])(
    'refuses the %s offer before any SMS is sent',
    async fault => {
      const run = await runBeinleumi(fault);
      expect(run.state.violations).toEqual([]);
      expect(run.result.errorType).toBe(ScraperErrorTypes.Generic);
      expect(run.result.errorMessage).toContain('assertPassword answer unrecognized');
      expect(run.trail).toEqual(OPENING_TRAIL);
      expect(run.hints).toEqual([]);
    },
  );
});
