/**
 * Login phase WK constants — form slots, success indicators, concept map.
 * Isolated: NO imports from Home, Dashboard, or Scrape WK.
 */

import type { SelectorCandidate } from '../../../Base/Config/LoginConfig.js';

/** Selector-kind discriminator strings, lifted out of every literal entry. */
const KIND_TEXT_CONTENT = 'textContent' as const;
const KIND_ARIA_LABEL = 'ariaLabel' as const;

/**
 * Hebrew form-label values repeated across multiple selector kinds
 * for the same field (labelText / placeholder / textContent variants).
 * Lifted to module-scope constants per the sonarjs/no-duplicate-string
 * rule — adding a new variant in a different kind is now a one-line
 * change.
 */
const LABEL_OTP_ONETIME = 'קוד חד פעמי' as const;
const LABEL_CARD_DIGITS = 'ספרות הכרטיס' as const;
const LABEL_ACCOUNT_NUMBER = 'מספר חשבון' as const;

/** The valid slot names in WK.LOGIN.ACTION.FORM. */
type FormSlot =
  | 'nationalId'
  | 'username'
  | 'password'
  | 'mfa'
  | 'accountNum'
  | 'submit'
  | 'otpArea'
  | 'cardDigits';

/** Login form field candidates per semantic slot. */
export const WK_LOGIN_FORM = {
  username: [
    { kind: 'labelText', value: 'שם משתמש' },
    { kind: 'labelText', value: 'קוד משתמש' },
    { kind: 'placeholder', value: 'שם משתמש' },
    { kind: 'placeholder', value: 'קוד משתמש' },
  ],
  nationalId: [
    { kind: 'labelText', value: 'תעודת זהות' },
    { kind: 'labelText', value: 'מספר זהות' },
    { kind: 'placeholder', value: 'תעודת זהות' },
    { kind: 'placeholder', value: 'מספר תעודת זהות' },
    { kind: 'placeholder', value: 'מספר זהות' },
    { kind: KIND_TEXT_CONTENT, value: 'מספר תעודת זהות' },
    { kind: KIND_TEXT_CONTENT, value: 'מספר זהות' },
  ],
  password: [
    { kind: 'xpath', value: '//input[@type="password"]' },
    { kind: 'placeholder', value: 'סיסמה' },
    { kind: 'placeholder', value: 'סיסמא' },
    { kind: 'placeholder', value: 'קוד סודי' },
    { kind: 'labelText', value: 'סיסמה' },
    { kind: 'labelText', value: 'סיסמא' },
    { kind: 'labelText', value: 'קוד סודי' },
    { kind: KIND_ARIA_LABEL, value: 'סיסמה' },
  ],
  mfa: [
    { kind: 'labelText', value: LABEL_OTP_ONETIME },
    { kind: 'labelText', value: 'קוד אימות' },
    { kind: 'placeholder', value: LABEL_OTP_ONETIME },
    { kind: 'placeholder', value: 'קוד SMS' },
    { kind: 'placeholder', value: 'קוד אימות' },
    { kind: 'placeholder', value: 'הזן קוד' },
  ],
  cardDigits: [
    { kind: 'labelText', value: 'ספרות' },
    { kind: KIND_ARIA_LABEL, value: LABEL_CARD_DIGITS },
    { kind: 'placeholder', value: LABEL_CARD_DIGITS },
    { kind: 'placeholder', value: '6 ספרות' },
    { kind: KIND_TEXT_CONTENT, value: LABEL_CARD_DIGITS },
    { kind: KIND_TEXT_CONTENT, value: '6 ספרות' },
  ],
  accountNum: [
    { kind: 'labelText', value: 'קוד מזהה' },
    { kind: 'labelText', value: LABEL_ACCOUNT_NUMBER },
    { kind: 'labelText', value: 'קוד משתמש' },

    { kind: KIND_ARIA_LABEL, value: LABEL_ACCOUNT_NUMBER },

    { kind: KIND_TEXT_CONTENT, value: 'קוד מזהה' },
    { kind: 'placeholder', value: LABEL_ACCOUNT_NUMBER },
    { kind: 'placeholder', value: 'מספר לקוח' },
    { kind: 'placeholder', value: 'קוד משתמש' },
  ],
  /** Structural submit — type="submit" in same DOM scope as password. Tried FIRST. */
  submitStructural: [
    { kind: 'xpath', value: '//button[@type="submit"]' },
    { kind: 'xpath', value: '//input[@type="submit"]' },
  ],
  /** Text-based submit fallback — tried only if structural not found in same frame. */
  submit: [
    { kind: KIND_ARIA_LABEL, value: 'כניסה' },
    { kind: KIND_ARIA_LABEL, value: 'התחברות' },
    { kind: KIND_ARIA_LABEL, value: 'התחבר' },
    { kind: 'xpath', value: '//button[contains(., "כניסה")]' },
    { kind: 'xpath', value: '//button[contains(., "התחברות")]' },
    { kind: 'xpath', value: '//button[contains(., "התחבר")]' },
    { kind: KIND_TEXT_CONTENT, value: 'כניסה' },
    { kind: KIND_TEXT_CONTENT, value: 'התחברות' },
    { kind: KIND_TEXT_CONTENT, value: 'שלח' },
    { kind: KIND_TEXT_CONTENT, value: 'המשך' },
    { kind: KIND_TEXT_CONTENT, value: 'אישור' },
  ],
  otpArea: [
    { kind: KIND_TEXT_CONTENT, value: 'כניסה באמצעות SMS' },
    { kind: KIND_TEXT_CONTENT, value: LABEL_OTP_ONETIME },
    { kind: KIND_TEXT_CONTENT, value: 'שלח קוד לנייד' },
  ],
} satisfies Record<string, readonly SelectorCandidate[]>;

/** Login error texts — detected by LOGIN.POST after form submission. */
export const WK_LOGIN_ERROR = [
  { kind: KIND_TEXT_CONTENT, value: 'פרטים שגויים' },
  { kind: KIND_TEXT_CONTENT, value: 'שכחת את הפרטים?' },
  { kind: KIND_TEXT_CONTENT, value: 'שגיאה' },
  { kind: KIND_TEXT_CONTENT, value: 'או לשחזר בקלות' },
  { kind: KIND_TEXT_CONTENT, value: 'אחד או יותר מפרטי ההזדהות שמסרת שגויים' },
  { kind: KIND_TEXT_CONTENT, value: 'אחד או יותר מהפרטים שהזנת שגויים' },
  { kind: KIND_TEXT_CONTENT, value: 'תהליך הזיהוי נכשל' },
  { kind: KIND_TEXT_CONTENT, value: 'פרטי ההתחברות שגויים' },
  { kind: KIND_TEXT_CONTENT, value: 'שם המשתמש או הסיסמה שהוזנו שגויים' },
  { kind: KIND_TEXT_CONTENT, value: 'תקינה' },
  { kind: KIND_TEXT_CONTENT, value: 'אינם תואמים' },
] as const;

/** Credential key → FORM slot mapping. */
export const WK_CONCEPT_MAP: Partial<Record<string, FormSlot>> = {
  id: 'nationalId',
  nationalId: 'nationalId',
  username: 'username',
  userCode: 'accountNum',
  accountNum: 'accountNum',
  num: 'accountNum',
  password: 'password',
  card6Digits: 'cardDigits',
  cardDigits: 'cardDigits',
  otpArea: 'otpArea',
  otpCode: 'mfa',
  __submit__: 'submit',
} as const;
