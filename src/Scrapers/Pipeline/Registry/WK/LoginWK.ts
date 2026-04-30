/**
 * Login phase WK constants — form slots, success indicators, concept map.
 * Isolated: NO imports from Home, Dashboard, or Scrape WK.
 */

import type { SelectorCandidate } from '../../../Base/Config/LoginConfig.js';

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
    { kind: 'textContent', value: 'מספר תעודת זהות' },
    { kind: 'textContent', value: 'מספר זהות' },
  ],
  password: [
    { kind: 'xpath', value: '//input[@type="password"]' },
    { kind: 'placeholder', value: 'סיסמה' },
    { kind: 'placeholder', value: 'סיסמא' },
    { kind: 'placeholder', value: 'קוד סודי' },
    { kind: 'labelText', value: 'סיסמה' },
    { kind: 'labelText', value: 'סיסמא' },
    { kind: 'labelText', value: 'קוד סודי' },
    { kind: 'ariaLabel', value: 'סיסמה' },
  ],
  mfa: [
    { kind: 'labelText', value: 'קוד חד פעמי' },
    { kind: 'labelText', value: 'קוד אימות' },
    { kind: 'placeholder', value: 'קוד חד פעמי' },
    { kind: 'placeholder', value: 'קוד SMS' },
    { kind: 'placeholder', value: 'קוד אימות' },
    { kind: 'placeholder', value: 'הזן קוד' },
  ],
  cardDigits: [
    { kind: 'labelText', value: 'ספרות' },
    { kind: 'ariaLabel', value: 'ספרות הכרטיס' },

    { kind: 'placeholder', value: 'ספרות הכרטיס' },
    { kind: 'placeholder', value: '6 ספרות' },
    { kind: 'placeholder', value: 'ספרות הכרטיס' },

    { kind: 'textContent', value: 'ספרות הכרטיס' },
    { kind: 'textContent', value: '6 ספרות' },
  ],
  accountNum: [
    { kind: 'labelText', value: 'קוד מזהה' },
    { kind: 'labelText', value: 'מספר חשבון' },
    { kind: 'labelText', value: 'קוד משתמש' },

    { kind: 'ariaLabel', value: 'מספר חשבון' },

    { kind: 'textContent', value: 'קוד מזהה' },
    { kind: 'placeholder', value: 'מספר חשבון' },
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
    { kind: 'ariaLabel', value: 'כניסה' },
    { kind: 'ariaLabel', value: 'התחברות' },
    { kind: 'ariaLabel', value: 'התחבר' },
    { kind: 'xpath', value: '//button[contains(., "כניסה")]' },
    { kind: 'xpath', value: '//button[contains(., "התחברות")]' },
    { kind: 'xpath', value: '//button[contains(., "התחבר")]' },
    { kind: 'textContent', value: 'כניסה' },
    { kind: 'textContent', value: 'התחברות' },
    { kind: 'textContent', value: 'שלח' },
    { kind: 'textContent', value: 'המשך' },
    { kind: 'textContent', value: 'אישור' },
  ],
  otpArea: [
    { kind: 'textContent', value: 'כניסה באמצעות SMS' },
    { kind: 'textContent', value: 'קוד חד פעמי' },
    { kind: 'textContent', value: 'שלח קוד לנייד' },
  ],
} satisfies Record<string, readonly SelectorCandidate[]>;

/** Login error texts — detected by LOGIN.POST after form submission. */
export const WK_LOGIN_ERROR = [
  { kind: 'textContent', value: 'פרטים שגויים' },
  { kind: 'textContent', value: 'שכחת את הפרטים?' },
  { kind: 'textContent', value: 'שגיאה' },
  { kind: 'textContent', value: 'או לשחזר בקלות' },
  { kind: 'textContent', value: 'אחד או יותר מפרטי ההזדהות שמסרת שגויים' },
  { kind: 'textContent', value: 'אחד או יותר מהפרטים שהזנת שגויים' },
  { kind: 'textContent', value: 'תהליך הזיהוי נכשל' },
  { kind: 'textContent', value: 'פרטי ההתחברות שגויים' },
  { kind: 'textContent', value: 'שם המשתמש או הסיסמה שהוזנו שגויים' },
  { kind: 'textContent', value: 'תקינה' },
  { kind: 'textContent', value: 'אינם תואמים' },
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
