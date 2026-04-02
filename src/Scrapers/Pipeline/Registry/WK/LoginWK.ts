/**
 * Login phase WK constants — form slots, success indicators, concept map.
 * Isolated: NO imports from Home, Dashboard, or Scrape WK.
 */

import type { SelectorCandidate } from '../../../Base/Config/LoginConfig.js';

/** The valid slot names in WK.LOGIN.ACTION.FORM. */
type FormSlot = 'id' | 'password' | 'mfa' | 'num' | 'submit' | 'otpArea';

/** Login form field candidates per semantic slot. */
export const WK_LOGIN_FORM = {
  id: [
    { kind: 'labelText', value: 'תעודת זהות' },
    { kind: 'labelText', value: 'מספר זהות' },
    { kind: 'labelText', value: 'שם משתמש' },
    { kind: 'labelText', value: 'קוד משתמש' },
    { kind: 'placeholder', value: 'תעודת זהות' },
    { kind: 'placeholder', value: 'מספר זהות' },
    { kind: 'placeholder', value: 'ת.ז' },
    { kind: 'placeholder', value: 'שם משתמש' },
    { kind: 'placeholder', value: 'קוד משתמש' },
    { kind: 'placeholder', value: 'מספר לקוח' },
    { kind: 'name', value: 'id' },
    { kind: 'name', value: 'username' },
    { kind: 'name', value: 'userCode' },
    { kind: 'name', value: 'nationalID' },
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
    { kind: 'name', value: 'password' },
  ],
  mfa: [
    { kind: 'labelText', value: 'ספרות' },
    { kind: 'placeholder', value: '6 ספרות' },
    { kind: 'placeholder', value: 'ספרות הכרטיס' },
    { kind: 'ariaLabel', value: 'ספרות הכרטיס' },
    { kind: 'labelText', value: 'קוד חד פעמי' },
    { kind: 'labelText', value: 'קוד אימות' },
    { kind: 'placeholder', value: 'קוד חד פעמי' },
    { kind: 'placeholder', value: 'קוד SMS' },
    { kind: 'placeholder', value: 'קוד אימות' },
    { kind: 'placeholder', value: 'הזן קוד' },
    { kind: 'name', value: 'otpCode' },
  ],
  num: [
    { kind: 'labelText', value: 'קוד מזהה' },
    { kind: 'labelText', value: 'מספר חשבון' },
    { kind: 'placeholder', value: 'מספר חשבון' },
    { kind: 'ariaLabel', value: 'מספר חשבון' },
    { kind: 'name', value: 'num' },
    { kind: 'textContent', value: 'קוד מזהה' },
  ],
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
  id: 'id',
  nationalID: 'id',
  username: 'id',
  userCode: 'id',
  num: 'num',
  password: 'password',
  card6Digits: 'mfa',
  otpCode: 'mfa',
  __submit__: 'submit',
} as const;
