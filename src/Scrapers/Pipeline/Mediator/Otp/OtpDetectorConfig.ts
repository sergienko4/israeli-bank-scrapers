import { type SelectorCandidate } from '../../../Base/Config/LoginConfig.js';

const KIND_PLACEHOLDER = 'placeholder' as const;
const KIND_ARIA_LABEL = 'ariaLabel' as const;
const KIND_NAME = 'name' as const;
const KIND_TEXT_CONTENT = 'textContent' as const;

const TEXT_OTP_PASSWORD = 'סיסמה חד פעמית' as const;
const TEXT_SEND_CODE = 'שלח קוד' as const;

/** Hebrew + English text patterns that indicate an OTP screen, most-specific first. */
export const OTP_TEXT_PATTERNS = [
  TEXT_OTP_PASSWORD,
  'קוד חד פעמי',
  'אימות זהות',
  'לצורך אימות',
  'בחר טלפון',
  TEXT_SEND_CODE,
  'קוד SMS',
  'קוד אימות',
  'one-time password',
  'SMS code',
] as const;

/** Selector candidates for locating OTP input fields — text-first. */
export const OTP_INPUT_CANDIDATES = [
  { kind: KIND_PLACEHOLDER, value: 'קוד חד פעמי' },
  { kind: KIND_PLACEHOLDER, value: TEXT_OTP_PASSWORD },
  { kind: KIND_PLACEHOLDER, value: 'קוד SMS' },
  { kind: KIND_PLACEHOLDER, value: 'קוד אימות' },
  { kind: KIND_PLACEHOLDER, value: 'הזן קוד' },
  { kind: KIND_ARIA_LABEL, value: 'קוד' },
  { kind: KIND_ARIA_LABEL, value: TEXT_OTP_PASSWORD },
  { kind: KIND_NAME, value: 'otpCode' },
] as const satisfies readonly SelectorCandidate[];

// CR PR #286 F7: click timeouts moved out of inline literals into config so
// the fallback (5000) and force-click (3000) paths stay in sync if either is
// tuned in the future.
export const OTP_FALLBACK_CLICK_TIMEOUT_MS = 5000;
export const OTP_FORCE_CLICK_TIMEOUT_MS = 3000;

/** Regex to detect masked phone number hints on OTP screens (e.g. `***1234`).
 *
 * Token boundaries: `(?<![\d*])` (leading) and `(?!\d)` (trailing) anchor the
 * pattern so it never returns a partial slice inside a longer masked value —
 * e.g. `***12345` does NOT yield a truncated `***1234` hint (CR PR #286 F12).
 *
 * Accepts 3+ asterisks to match documented hint shapes from real bank screens
 * (CR PR #286 finding F10: previously rejected `***1234` due to `{4,32}` lower
 * bound). Both quantifiers are bounded ({3,32} and {2,4}) so the matcher cannot
 * super-linearly backtrack on adversarial input. */
export const PHONE_PATTERN = /(?<![\d*])\*{3,32}\d{2,4}(?!\d)/;

/** Narrow phone-hint pattern used by OtpFill / OtpTrigger frame-scan extractors.
 *
 * Shape `***1` to `*******1234` — narrower bounds than {@link PHONE_PATTERN}
 * because the Fill/Trigger extractors operate on per-frame body text where
 * the typical bank-rendered hint is 3-7 asterisks + 1-4 trailing digits.
 *
 * Single source of truth for both OtpFillPhaseActions.extractHintFromFrame and
 * OtpTriggerPhaseActions.extractHintFromFrame (CR PR #286 F4 — DRY centralise).
 * Bounded quantifiers ({3,7} and {1,4}) prevent super-linear backtracking. */
export const PHONE_HINT_PATTERN = /(?<![\d*])\*{3,7}\d{1,4}(?!\d)/;

/** Trailing-digits extractor — paired with {@link PHONE_HINT_PATTERN} to pull
 * the last 1-4 digits out of a matched masked hint. Shared by both Fill and
 * Trigger phase extractors so the digit-window stays in sync. */
export const PHONE_LAST_DIGITS = /(\d{1,4})$/;

/** Selector candidates for the OTP submit/confirm button — text-first, no element assumption. */
export const OTP_SUBMIT_CANDIDATES = [
  { kind: KIND_TEXT_CONTENT, value: 'אישור' },
  { kind: KIND_TEXT_CONTENT, value: 'אשר' },
  { kind: KIND_TEXT_CONTENT, value: 'המשך' },
  { kind: KIND_TEXT_CONTENT, value: 'כניסה' },
  { kind: KIND_ARIA_LABEL, value: 'אישור' },
  { kind: KIND_ARIA_LABEL, value: 'כניסה' },
] as const satisfies readonly SelectorCandidate[];

/** Selector candidates for the SMS send/trigger button — text-first, no element assumption. */
export const SMS_TRIGGER_CANDIDATES = [
  { kind: KIND_TEXT_CONTENT, value: TEXT_SEND_CODE },
  { kind: KIND_TEXT_CONTENT, value: 'שלח' },
  { kind: KIND_TEXT_CONTENT, value: 'קבל קוד' },
  { kind: KIND_TEXT_CONTENT, value: `לקבלת ${TEXT_OTP_PASSWORD}` },
  { kind: KIND_TEXT_CONTENT, value: 'שלח SMS' },
  { kind: KIND_ARIA_LABEL, value: 'שלח' },
  { kind: KIND_ARIA_LABEL, value: TEXT_SEND_CODE },
] as const satisfies readonly SelectorCandidate[];
