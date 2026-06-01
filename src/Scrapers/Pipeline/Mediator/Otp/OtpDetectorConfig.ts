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
export const OTP_INPUT_CANDIDATES: SelectorCandidate[] = [
  { kind: KIND_PLACEHOLDER, value: 'קוד חד פעמי' },
  { kind: KIND_PLACEHOLDER, value: TEXT_OTP_PASSWORD },
  { kind: KIND_PLACEHOLDER, value: 'קוד SMS' },
  { kind: KIND_PLACEHOLDER, value: 'קוד אימות' },
  { kind: KIND_PLACEHOLDER, value: 'הזן קוד' },
  { kind: KIND_ARIA_LABEL, value: 'קוד' },
  { kind: KIND_ARIA_LABEL, value: TEXT_OTP_PASSWORD },
  { kind: KIND_NAME, value: 'otpCode' },
];

/** Regex to detect masked phone number hints on OTP screens (e.g. ****1234).
 * Both quantifiers are bounded ({4,32} and {2,4}) so the matcher cannot
 * super-linearly backtrack on adversarial input. */
export const PHONE_PATTERN = /\*{4,32}\d{2,4}/;

/** Selector candidates for the OTP submit/confirm button — text-first, no element assumption. */
export const OTP_SUBMIT_CANDIDATES: SelectorCandidate[] = [
  { kind: KIND_TEXT_CONTENT, value: 'אישור' },
  { kind: KIND_TEXT_CONTENT, value: 'אשר' },
  { kind: KIND_TEXT_CONTENT, value: 'המשך' },
  { kind: KIND_TEXT_CONTENT, value: 'כניסה' },
  { kind: KIND_ARIA_LABEL, value: 'אישור' },
  { kind: KIND_ARIA_LABEL, value: 'כניסה' },
];

/** Selector candidates for the SMS send/trigger button — text-first, no element assumption. */
export const SMS_TRIGGER_CANDIDATES: SelectorCandidate[] = [
  { kind: KIND_TEXT_CONTENT, value: TEXT_SEND_CODE },
  { kind: KIND_TEXT_CONTENT, value: 'שלח' },
  { kind: KIND_TEXT_CONTENT, value: 'קבל קוד' },
  { kind: KIND_TEXT_CONTENT, value: `לקבלת ${TEXT_OTP_PASSWORD}` },
  { kind: KIND_TEXT_CONTENT, value: 'שלח SMS' },
  { kind: KIND_ARIA_LABEL, value: 'שלח' },
  { kind: KIND_ARIA_LABEL, value: TEXT_SEND_CODE },
];
