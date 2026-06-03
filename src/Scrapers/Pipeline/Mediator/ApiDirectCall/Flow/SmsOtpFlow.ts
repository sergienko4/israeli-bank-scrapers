/**
 * SmsOtpFlow barrel — generic orchestrator for the 'sms-otp' flow-kind.
 *
 * Re-exports the public surface from co-located siblings: `.types`,
 * `.prep`, `.prehook`, `.reduce`, `.result`, `.run`.
 */

export { runSmsOtpFlow } from './SmsOtpFlow.run.js';
export type { IFlowResult, IRunSmsOtpArgs } from './SmsOtpFlow.types.js';
