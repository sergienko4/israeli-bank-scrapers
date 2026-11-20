/**
 * Hapoalim mock faults — every way the synthetic app bank misbehaves, and the
 * per-run state its routes share.
 *
 * Rule #18: every value here is SYNTHETIC. No real PII.
 */

import type { IRecordedCall, NetworkFault } from '../Helpers/FetchMockKit.js';
import { HP_AUTH_COOKIE, HP_FRESH_AUTH_COOKIE } from './HapoalimMockData.js';

/** A verify answer other than the default `LogonOTP`. */
export type VerifyFault =
  'landpage' | 'newDevice' | 'locked' | 'reissue' | 'unknownState' | 'noFlow' | 'verifyErrors';

/** A `csrfcookie` verify sets other than the default. */
export type CsrfFault = 'noCsrf' | 'csrfBadEscape' | 'csrfLong';

/** An otp-init answer other than the default `logonotp`. */
export type ChallengeFault = 'otpInitStateOther' | 'otpInitStateObject' | 'otpInitStateNumber';

/** An otp-verify answer other than the default. */
export type OtpVerifyFault = 'otpVerifyLocked' | 'otpVerifyReissue' | 'otpVerifyErrors';

/**
 * A step1 or data answer other than the default. `sessionExpired`: the bank
 * opens and accepts only a fresh session and answers a refused `step1` with
 * `401`. `step1Redirect`: the same refusal in the bank's real shape, a `302`
 * to `/invalid_session` that names the step1 URL as its target.
 * `step1RedirectRegistered`: the same 302, but the cold verify lands without
 * an OTP because the device is already enrolled. `step1Errors`: the
 * registration call answers 200 with an app error body.
 */
export type DataFault =
  | 'txns204'
  | 'txns207'
  | 'txns500'
  | 'expire401'
  | 'sessionExpired'
  | 'step1Redirect'
  | 'step1RedirectRegistered'
  | 'step1Errors';

/** How the mock misbehaves: a wire fault, or a bank answer. */
export type HapoalimFault =
  | 'none'
  | NetworkFault
  | VerifyFault
  | CsrfFault
  | ChallengeFault
  | OtpVerifyFault
  | DataFault
  | 'verify302'
  | 'verify307';

/** One run's fault. */
export interface IMockRun {
  readonly fault: HapoalimFault;
}

/** One route: answers a recorded call within a run. */
export type Route = (call: IRecordedCall, run: IMockRun) => Response;

/** The text a bank error carries; it must never surface. */
export const HP_BANK_NOTICE = 'SYNTHETIC bank notice 5512';

/** The session each fault opens and accepts; the default is the usual one. */
const AUTH_COOKIES: Readonly<Partial<Record<HapoalimFault, string>>> = {
  sessionExpired: HP_FRESH_AUTH_COOKIE,
  step1Redirect: HP_FRESH_AUTH_COOKIE,
  step1RedirectRegistered: HP_FRESH_AUTH_COOKIE,
};

/**
 * The session cookie the bank opens and accepts in a run.
 * @param run - The run's fault.
 * @returns The `name=value` pair.
 */
export function authCookieOf(run: IMockRun): string {
  return AUTH_COOKIES[run.fault] ?? HP_AUTH_COOKIE;
}
