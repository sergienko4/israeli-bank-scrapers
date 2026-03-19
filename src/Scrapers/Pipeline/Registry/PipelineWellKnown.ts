/**
 * Pipeline-only WellKnown selector dictionaries — text-based candidates ONLY.
 * All `kind: 'css'` entries from WellKnownSelectors.ts are intentionally removed.
 * The Mediator finds elements by visible Hebrew text, then extracts metadata dynamically.
 * Do NOT add `kind: 'css'` entries here — that defeats the architecture.
 */

import type { SelectorCandidate } from '../../Base/Config/LoginConfig.js';

/**
 * Pipeline login-field fallback dictionary — visible text only.
 * Order = resolution priority: labelText → placeholder → ariaLabel → name → textContent.
 * No CSS — the Mediator extracts id/class/type dynamically after text resolution.
 */
export const PIPELINE_WELL_KNOWN_LOGIN = {
  username: [
    // --- visible text ---
    { kind: 'labelText', value: 'שם משתמש' },
    { kind: 'labelText', value: 'קוד משתמש' },
    { kind: 'labelText', value: 'מספר לקוח' },
    { kind: 'placeholder', value: 'שם משתמש' },
    { kind: 'placeholder', value: 'קוד משתמש' },
    { kind: 'placeholder', value: 'מספר לקוח' },
    { kind: 'placeholder', value: 'תז' },
    { kind: 'ariaLabel', value: 'שם משתמש' },
    { kind: 'ariaLabel', value: 'קוד משתמש' },
    // --- semantic HTML ---
    { kind: 'name', value: 'username' },
    { kind: 'name', value: 'userCode' },
    // --- walk-up DOM ---
    { kind: 'textContent', value: 'שם משתמש' },
    { kind: 'textContent', value: 'קוד משתמש' },
  ],
  userCode: [
    // --- visible text ---
    { kind: 'labelText', value: 'קוד משתמש' },
    { kind: 'labelText', value: 'שם משתמש' },
    { kind: 'placeholder', value: 'קוד משתמש' },
    { kind: 'placeholder', value: 'שם משתמש' },
    { kind: 'placeholder', value: 'מספר לקוח' },
    { kind: 'ariaLabel', value: 'קוד משתמש' },
    // --- semantic HTML ---
    { kind: 'name', value: 'userCode' },
    { kind: 'name', value: 'username' },
    // --- walk-up DOM ---
    { kind: 'textContent', value: 'קוד משתמש' },
    { kind: 'textContent', value: 'שם משתמש' },
  ],
  password: [
    // --- visible text ---
    { kind: 'labelText', value: 'סיסמה' },
    { kind: 'labelText', value: 'סיסמא' },
    { kind: 'labelText', value: 'קוד סודי' },
    { kind: 'placeholder', value: 'סיסמה' },
    { kind: 'placeholder', value: 'סיסמא' },
    { kind: 'placeholder', value: 'קוד סודי' },
    { kind: 'ariaLabel', value: 'סיסמה' },
    // --- semantic HTML ---
    { kind: 'name', value: 'password' },
    // --- walk-up DOM ---
    { kind: 'textContent', value: 'סיסמה' },
    { kind: 'textContent', value: 'סיסמא' },
  ],
  id: [
    // --- visible text ---
    { kind: 'labelText', value: 'תעודת זהות' },
    { kind: 'labelText', value: 'מספר זהות' },
    { kind: 'placeholder', value: 'תעודת זהות' },
    { kind: 'placeholder', value: 'מספר זהות' },
    { kind: 'placeholder', value: 'ת.ז' },
    { kind: 'ariaLabel', value: 'תעודת זהות' },
    // --- semantic HTML ---
    { kind: 'name', value: 'id' },
    // --- walk-up DOM ---
    { kind: 'textContent', value: 'תעודת זהות' },
    { kind: 'textContent', value: 'מספר זהות' },
  ],
  nationalID: [
    // --- visible text ---
    { kind: 'labelText', value: 'תעודת זהות' },
    { kind: 'labelText', value: 'מספר זהות' },
    { kind: 'placeholder', value: 'תעודת זהות' },
    { kind: 'placeholder', value: 'מספר זהות' },
    { kind: 'ariaLabel', value: 'תעודת זהות' },
    // --- semantic HTML ---
    { kind: 'name', value: 'nationalID' },
    { kind: 'name', value: 'id' },
    // --- walk-up DOM ---
    { kind: 'textContent', value: 'תעודת זהות' },
    { kind: 'textContent', value: 'מספר זהות' },
  ],
  card6Digits: [
    // --- visible text ---
    { kind: 'labelText', value: 'ספרות' },
    { kind: 'placeholder', value: '6 ספרות' },
    { kind: 'placeholder', value: 'ספרות הכרטיס' },
    { kind: 'ariaLabel', value: 'ספרות הכרטיס' },
    // --- walk-up DOM ---
    { kind: 'textContent', value: 'ספרות' },
  ],
  num: [
    // --- visible text ---
    { kind: 'labelText', value: 'קוד מזהה' },
    { kind: 'labelText', value: 'מספר חשבון' },
    { kind: 'placeholder', value: 'מספר חשבון' },
    { kind: 'ariaLabel', value: 'מספר חשבון' },
    // --- semantic HTML ---
    { kind: 'name', value: 'num' },
    // --- walk-up DOM ---
    { kind: 'textContent', value: 'קוד מזהה' },
    { kind: 'textContent', value: 'מספר חשבון' },
  ],
  otpCode: [
    // --- visible text ---
    { kind: 'labelText', value: 'קוד חד פעמי' },
    { kind: 'labelText', value: 'קוד אימות' },
    { kind: 'placeholder', value: 'קוד חד פעמי' },
    { kind: 'placeholder', value: 'קוד SMS' },
    { kind: 'placeholder', value: 'קוד אימות' },
    { kind: 'placeholder', value: 'הזן קוד' },
    // --- semantic HTML ---
    { kind: 'name', value: 'otpCode' },
    // --- walk-up DOM ---
    { kind: 'textContent', value: 'קוד חד פעמי' },
    { kind: 'textContent', value: 'קוד אימות' },
  ],
  /** Login method selection tab — click to navigate to username+password form. */
  loginMethodTab: [
    { kind: 'textContent', value: 'כניסה עם שם משתמש' },
    { kind: 'textContent', value: 'כניסה עם סיסמה' },
  ],
  /** Universal submit-button fallback — visible text only, zero CSS. */
  __submit__: [
    // --- visible text ---
    { kind: 'ariaLabel', value: 'כניסה' },
    { kind: 'ariaLabel', value: 'התחברות' },
    { kind: 'ariaLabel', value: 'התחבר' },
    { kind: 'xpath', value: '//button[contains(., "כניסה")]' },
    { kind: 'xpath', value: '//button[contains(., "התחברות")]' },
    { kind: 'xpath', value: '//button[contains(., "התחבר")]' },
    // --- walk-up DOM ---
    { kind: 'textContent', value: 'כניסה' },
    { kind: 'textContent', value: 'התחברות' },
    { kind: 'textContent', value: 'שלח' },
    { kind: 'textContent', value: 'המשך' },
    { kind: 'textContent', value: 'אישור' },
  ],
} satisfies Record<string, SelectorCandidate[]>;

/**
 * Pipeline dashboard-field fallback dictionary — visible text only.
 * Same structure as WELL_KNOWN_DASHBOARD_SELECTORS but no CSS entries.
 */
export const PIPELINE_WELL_KNOWN_DASHBOARD = {
  loginLink: [
    { kind: 'textContent', value: 'כניסה רגילה' },
    { kind: 'textContent', value: 'כניסה עם שם משתמש' },
    { kind: 'textContent', value: 'כניסה לחשבון' },
    { kind: 'textContent', value: 'כניסה לאיזור האישי' },
    { kind: 'textContent', value: 'כניסה והרשמה' },
    { kind: 'textContent', value: 'התחברות' },
    { kind: 'textContent', value: 'כניסה' },
    { kind: 'ariaLabel', value: 'כניסה לחשבון' },
  ],
  logoutLink: [
    { kind: 'textContent', value: 'יציאה' },
    { kind: 'textContent', value: 'התנתק' },
    { kind: 'textContent', value: 'התנתקות' },
    { kind: 'textContent', value: 'יציאה מהחשבון' },
  ],
  errorIndicator: [
    { kind: 'textContent', value: 'פרטים שגויים' },
    { kind: 'textContent', value: 'שכחת את הפרטים?' },
    { kind: 'textContent', value: 'שגיאה' },
    { kind: 'textContent', value: 'או לשחזר בקלות' },
    { kind: 'textContent', value: 'אחד או יותר מפרטי ההזדהות שמסרת שגויים' },
    { kind: 'textContent', value: 'פרטי ההתחברות שגויים' },
    // VisaCal connect-iframe error
    { kind: 'textContent', value: 'שם המשתמש או הסיסמה שהוזנו שגויים' },
  ],
  closeElement: [
    { kind: 'textContent', value: 'סגור' },
    { kind: 'textContent', value: 'close' },
    { kind: 'textContent', value: 'ביטול' },
    { kind: 'textContent', value: '✕' },
    { kind: 'ariaLabel', value: 'סגור' },
    { kind: 'ariaLabel', value: 'close' },
  ],
  accountSelector: [
    { kind: 'textContent', value: 'חשבון' },
    { kind: 'textContent', value: 'בחר חשבון' },
    { kind: 'textContent', value: 'חשבונות' },
    { kind: 'ariaLabel', value: 'בחר חשבון' },
  ],
  dashboardIndicator: [
    { kind: 'textContent', value: 'שלום' },
    { kind: 'textContent', value: 'חשבון עו"ש' },
    { kind: 'textContent', value: 'תנועות אחרונות' },
    { kind: 'textContent', value: 'יתרה' },
    { kind: 'textContent', value: 'סך הכל' },
  ],
  changePasswordIndicator: [
    { kind: 'textContent', value: 'שינוי סיסמה' },
    { kind: 'textContent', value: 'חידוש סיסמה' },
    { kind: 'textContent', value: 'עדכון סיסמה' },
  ],
  privateCustomers: [
    { kind: 'textContent', value: 'לקוחות פרטיים' },
    { kind: 'textContent', value: 'אזור אישי' },
    { kind: 'textContent', value: 'כניסה עם סיסמה' },
  ],
  transactionsLink: [
    { kind: 'textContent', value: 'תנועות' },
    { kind: 'textContent', value: 'פעולות' },
    { kind: 'textContent', value: 'תנועות אחרונות' },
    { kind: 'textContent', value: 'פירוט תנועות' },
  ],
  skipLink: [
    { kind: 'textContent', value: 'דלג' },
    { kind: 'textContent', value: 'דלג לחשבון' },
    { kind: 'textContent', value: 'המשך' },
  ],
  balance: [
    { kind: 'textContent', value: 'יתרה' },
    { kind: 'textContent', value: 'סה"כ' },
    { kind: 'ariaLabel', value: 'יתרה' },
  ],
  loadingIndicator: [
    { kind: 'ariaLabel', value: 'טוען' },
    { kind: 'textContent', value: 'טוען' },
  ],
  fromDateInput: [
    { kind: 'placeholder', value: 'מתאריך' },
    { kind: 'placeholder', value: 'מהתאריך' },
    { kind: 'placeholder', value: 'תאריך התחלה' },
  ],
  idFormIndicator: [
    { kind: 'textContent', value: 'תעודת הזהות' },
    { kind: 'textContent', value: 'תעודת זהות' },
    { kind: 'textContent', value: 'ת.ז.' },
  ],
  pendingTransactions: [
    { kind: 'textContent', value: 'פעולות עתידיות' },
    { kind: 'textContent', value: 'תנועות עתידיות' },
    { kind: 'textContent', value: 'המתנה' },
  ],
} satisfies Record<string, SelectorCandidate[]>;
