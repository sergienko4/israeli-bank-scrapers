/**
 * OTP Detector orchestrator — slim re-exporter.
 * Each detection/click concern lives in its own sibling file to
 * satisfy the strict Mediator overlay (max-lines:150, max-lines-per-function:10).
 *
 * Public surface preserved exactly so `src/Common/OtpDetector.ts`
 * and every other consumer keeps importing the same six symbols.
 */

export { clickFromCandidates, clickOtpTriggerIfPresent } from './OtpDetector.Click.js';
export { default as findOtpSubmitSelector } from './OtpDetector.Submit.js';
export { detectOtpScreen, extractPhoneHint } from './OtpDetector.Text.js';
export { OTP_SUBMIT_CANDIDATES } from './OtpDetectorConfig.js';
