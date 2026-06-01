/**
 * Common ↔ Pipeline UNIFY shim (Phase 3 — Commit 6 of 11).
 *
 * The canonical OTP detector configuration moved to
 * `src/Scrapers/Pipeline/Mediator/Otp/OtpDetectorConfig.ts` alongside
 * `OtpDetector.ts`. This shim re-exports the five configuration
 * constants so Common-tree readers (notably the Common OtpDetector
 * shim's re-export consumers and the OtpDetector unit-test fixtures)
 * keep compiling against `src/Common/Config/OtpDetectorConfig.js`.
 *
 * @deprecated Import from
 * `src/Scrapers/Pipeline/Mediator/Otp/OtpDetectorConfig.ts` directly.
 * This shim will be deleted when the last legacy caller migrates.
 */

export {
  OTP_INPUT_CANDIDATES,
  OTP_SUBMIT_CANDIDATES,
  OTP_TEXT_PATTERNS,
  PHONE_PATTERN,
  SMS_TRIGGER_CANDIDATES,
} from '../../Scrapers/Pipeline/Mediator/Otp/OtpDetectorConfig.js';
