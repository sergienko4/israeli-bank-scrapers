/**
 * Hapoalim mock faults — every way the synthetic bank misbehaves, and the
 * per-run state its routes share.
 *
 * Rule #18: every value here is SYNTHETIC. No real PII.
 */

import type { IRecordedCall, NetworkFault } from '../Helpers/FetchMockKit.js';

/** A verify answer other than the default `LogonOTP`. */
export type VerifyFault =
  | 'landpage'
  | 'locked'
  | 'reissue'
  | 'unknownState'
  | 'foreignTarget'
  | 'targetNumber'
  | 'noFlow'
  | 'verifyErrors';

/** A `csrfcookie` verify sets other than the default. */
export type CsrfFault = 'noCsrf' | 'csrfBadEscape' | 'csrfLong';

/** An init or otp-init answer other than the default. */
export type ChallengeFault =
  | 'initResultString'
  | 'initResultMissing'
  | 'otpInitStateOther'
  | 'otpInitStateObject'
  | 'otpInitStateNumber';

/** An otp-verify answer other than the default. */
export type OtpVerifyFault = 'otpVerifyLocked' | 'otpVerifyReissue' | 'otpVerifyErrors';

/** A landing or data answer other than the default. */
export type DataFault = 'pageIdBad' | 'landingErrors' | 'txns204' | 'txns207' | 'expire401';

/** How the mock misbehaves: a step-0 fault, a wire fault, or a bank answer. */
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
