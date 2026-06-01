/**
 * Common ↔ Pipeline UNIFY shim (Phase 3 — Commit 6 of 11).
 *
 * The canonical implementation moved to
 * `src/Scrapers/Pipeline/Mediator/Otp/OtpDetector.ts`. This shim
 * re-exports the public surface so the sole production caller
 * (`src/Common/OtpHandler.ts`) and the four Common-tree unit-test
 * files (`OtpDetector.test.ts`, `OtpDetectorAdvanced.test.ts`,
 * `OtpFlowStates.test.ts`, plus `OtpHandler*` indirectly) keep
 * compiling against `src/Common/OtpDetector.js`.
 *
 * No brand-type wrappers are needed: every re-exported signature
 * returns either `Promise<boolean>`, `Promise<string>`, or a
 * `SelectorCandidate[]` constant — none of these are bare primitives,
 * so Pipeline Rule #15 is satisfied at the canonical site.
 *
 * @deprecated Import from
 * `src/Scrapers/Pipeline/Mediator/Otp/OtpDetector.ts` directly.
 * This shim will be deleted when the last legacy caller migrates.
 */

export {
  clickFromCandidates,
  clickOtpTriggerIfPresent,
  detectOtpScreen,
  extractPhoneHint,
  findOtpSubmitSelector,
  OTP_SUBMIT_CANDIDATES,
} from '../Scrapers/Pipeline/Mediator/Otp/OtpDetector.js';
