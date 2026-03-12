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

/** Selector candidates for locating OTP input fields on a page. */
export const OTP_INPUT_CANDIDATES: SelectorCandidate[] = [
  { kind: 'placeholder', value: 'קוד חד פעמי' },
  { kind: 'placeholder', value: 'קוד SMS' },
  { kind: 'placeholder', value: 'קוד אימות' },
  { kind: 'placeholder', value: 'הזן קוד' },
  { kind: 'ariaLabel', value: 'קוד' },
  { kind: 'name', value: 'otpCode' },
  { kind: 'css', value: '#sendSms' },
  { kind: 'css', value: '#codeinput' },
];

/** Regex to detect masked phone number hints on OTP screens (e.g. ****1234). */
export const PHONE_PATTERN = /[*]{4,}\d{2,4}/;

/** Selector candidates for locating the OTP submit/confirm button. */
export const OTP_SUBMIT_CANDIDATES: SelectorCandidate[] = [
  { kind: 'xpath', value: '//button[contains(.,"אשר")]' },
  { kind: 'xpath', value: '//button[contains(.,"המשך")]' },
  { kind: 'xpath', value: '//button[contains(.,"אישור")]' },
  { kind: 'xpath', value: '//button[contains(.,"כניסה")]' },
  { kind: 'ariaLabel', value: 'כניסה' },
  { kind: 'css', value: 'button[type="submit"]' },
  { kind: 'css', value: 'input[type="button"]' },
];

/** Selector candidates for locating the SMS trigger button. */
export const SMS_TRIGGER_CANDIDATES: SelectorCandidate[] = [
  { kind: 'css', value: '#sendSms' },
  { kind: 'xpath', value: '//button[contains(.,"SMS")]' },
  { kind: 'ariaLabel', value: 'שלח SMS' },
  { kind: 'css', value: 'input[type="radio"][value="SMS"]' },
  { kind: 'xpath', value: '//button[contains(.,"שלח")]' },
  { kind: 'xpath', value: '//button[contains(.,"קבל קוד")]' },
];
