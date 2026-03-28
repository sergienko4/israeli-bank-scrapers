import { type SelectorCandidate } from '../../Scrapers/Base/Config/LoginConfig.js';

/** Hebrew + English text patterns that indicate an OTP screen, most-specific first. */
export const OTP_TEXT_PATTERNS = [
  'סיסמה חד פעמית',
  'קוד חד פעמי',
  'אימות זהות',
  'לצורך אימות',
  'בחר טלפון',
  'שלח קוד',
  'קוד SMS',
  'קוד אימות',
  'one-time password',
  'SMS code',
] as const;

/** Selector candidates for locating OTP input fields — text-first. */
export const OTP_INPUT_CANDIDATES: SelectorCandidate[] = [
  { kind: 'placeholder', value: 'קוד חד פעמי' },
  { kind: 'placeholder', value: 'סיסמה חד פעמית' },
  { kind: 'placeholder', value: 'קוד SMS' },
  { kind: 'placeholder', value: 'קוד אימות' },
  { kind: 'placeholder', value: 'הזן קוד' },
  { kind: 'ariaLabel', value: 'קוד' },
  { kind: 'ariaLabel', value: 'סיסמה חד פעמית' },
  { kind: 'name', value: 'otpCode' },
];

/** Regex to detect masked phone number hints on OTP screens (e.g. ****1234). */
export const PHONE_PATTERN = /[*]{4,}\d{2,4}/;

/** Selector candidates for the OTP submit/confirm button — text-first, no element assumption. */
export const OTP_SUBMIT_CANDIDATES: SelectorCandidate[] = [
  { kind: 'css', value: 'input[type="button"][value="אישור"]' },
  { kind: 'css', value: 'input[type="submit"][value="אישור"]' },
  { kind: 'textContent', value: 'אישור' },
  { kind: 'textContent', value: 'אשר' },
  { kind: 'textContent', value: 'המשך' },
  { kind: 'textContent', value: 'כניסה' },
  { kind: 'ariaLabel', value: 'אישור' },
  { kind: 'ariaLabel', value: 'כניסה' },
];

/** Selector candidates for the SMS send/trigger button — text-first, no element assumption. */
export const SMS_TRIGGER_CANDIDATES: SelectorCandidate[] = [
  { kind: 'textContent', value: 'שלח קוד' },
  { kind: 'textContent', value: 'שלח' },
  { kind: 'textContent', value: 'קבל קוד' },
  { kind: 'textContent', value: 'לקבלת סיסמה חד פעמית' },
  { kind: 'textContent', value: 'שלח SMS' },
  { kind: 'ariaLabel', value: 'שלח' },
  { kind: 'ariaLabel', value: 'שלח קוד' },
];
