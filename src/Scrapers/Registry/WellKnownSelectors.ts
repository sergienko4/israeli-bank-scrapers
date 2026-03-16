import { type SelectorCandidate } from '../Base/Config/LoginConfig.js';

/**
 * Global login-field fallback dictionary used by SelectorResolver on every bank.
 * Order = middleware priority: visible text first, CSS fallback, textContent last resort.
 * textContent (walk-up DOM) is placed AFTER CSS — it's the absolute last resort
 * for banks that don't use standard labels/placeholders/aria/CSS.
 */
export const WELL_KNOWN_LOGIN_SELECTORS = {
  username: [
    // --- visible text (what the user sees) ---
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
    // --- CSS fallback ---
    { kind: 'css', value: '#username' }, // Beinleumi group, Yahav
    { kind: 'css', value: '#user-name' }, // Max
    { kind: 'css', value: '#userNumberDesktopHeb' }, // Mizrahi
    { kind: 'css', value: '[formcontrolname="userName"]' }, // VisaCal
    // --- walk-up DOM (absolute last resort) ---
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
    // --- CSS fallback ---
    { kind: 'css', value: '#userCode' }, // Hapoalim
    // --- walk-up DOM (absolute last resort) ---
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
    // --- CSS fallback ---
    { kind: 'css', value: 'input[type="password"]' },
    { kind: 'css', value: '#password' }, // Hapoalim, Max, Beinleumi, Yahav
    { kind: 'css', value: '#loginPassword' }, // Behatsdaa, BeyahadBishvilha
    { kind: 'css', value: '#tzPassword' }, // Discount
    { kind: 'css', value: '#passwordDesktopHeb' }, // Mizrahi
    { kind: 'css', value: '[formcontrolname="password"]' }, // VisaCal
    // --- walk-up DOM (absolute last resort) ---
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
    // --- CSS fallback ---
    { kind: 'css', value: '#loginId' }, // Behatsdaa, BeyahadBishvilha
    { kind: 'css', value: '#tzId' }, // Discount
    // --- walk-up DOM (absolute last resort) ---
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
    // --- CSS fallback ---
    { kind: 'css', value: '#pinno' }, // Yahav
    // --- walk-up DOM (absolute last resort) ---
    { kind: 'textContent', value: 'תעודת זהות' },
    { kind: 'textContent', value: 'מספר זהות' },
  ],
  card6Digits: [
    // --- visible text ---
    { kind: 'labelText', value: 'ספרות' },
    { kind: 'placeholder', value: '6 ספרות' },
    { kind: 'placeholder', value: 'ספרות הכרטיס' },
    { kind: 'ariaLabel', value: 'ספרות הכרטיס' },
    // --- walk-up DOM (last resort) ---
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
    // --- CSS fallback ---
    { kind: 'css', value: '#aidnum' }, // Discount
    // --- walk-up DOM (absolute last resort) ---
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
    // --- walk-up DOM (last resort) ---
    { kind: 'textContent', value: 'קוד חד פעמי' },
    { kind: 'textContent', value: 'קוד אימות' },
  ],
  /** Universal submit-button fallback — visible text first, CSS last */
  __submit__: [
    // --- visible text ---
    { kind: 'ariaLabel', value: 'כניסה' },
    { kind: 'ariaLabel', value: 'התחברות' },
    { kind: 'ariaLabel', value: 'התחבר' },
    { kind: 'xpath', value: '//button[contains(., "כניסה")]' },
    { kind: 'xpath', value: '//button[contains(., "התחברות")]' },
    { kind: 'xpath', value: '//button[contains(., "התחבר")]' },
    // --- CSS fallback ---
    { kind: 'css', value: 'button[type="submit"]' },
    // --- walk-up DOM (absolute last resort — button/link/select ancestor) ---
    { kind: 'textContent', value: 'כניסה' },
    { kind: 'textContent', value: 'התחברות' },
    { kind: 'textContent', value: 'שלח' },
    { kind: 'textContent', value: 'המשך' },
    { kind: 'textContent', value: 'אישור' },
  ],
} satisfies Record<string, SelectorCandidate[]>;

/**
 * Global dashboard/navigation fallback dictionary.
 * Used by resolveDashboardField() and bank configs for post-login detection.
 * Hebrew text first — same concept expressed in all bank variants.
 */
export const WELL_KNOWN_DASHBOARD_SELECTORS = {
  /** Login/enter link — navigate to login page or personal area */
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
  /** Logout/disconnect link */
  logoutLink: [
    { kind: 'textContent', value: 'יציאה' },
    { kind: 'textContent', value: 'התנתק' },
    { kind: 'textContent', value: 'התנתקות' },
    { kind: 'textContent', value: 'יציאה מהחשבון' },
  ],
  /**
   * Error/invalid credentials indicators.
   * Note: 'שכחת את הפרטים?' and 'או לשחזר בקלות' are Max-specific post-error help texts
   * that appear alongside the login error popup — they indicate the error state, not help text
   * shown during normal login. These are intentionally included as error indicators.
   */
  errorIndicator: [
    { kind: 'textContent', value: 'פרטים שגויים' },
    { kind: 'textContent', value: 'שכחת את הפרטים?' },
    { kind: 'textContent', value: 'שגיאה' },
    { kind: 'textContent', value: 'או לשחזר בקלות' },
    { kind: 'textContent', value: 'אחד או יותר מפרטי ההזדהות שמסרת שגויים' },
    { kind: 'textContent', value: 'פרטי ההתחברות שגויים' },
  ],
  /** Close/dismiss popup or overlay */
  closeElement: [
    { kind: 'textContent', value: 'סגור' },
    { kind: 'textContent', value: 'close' },
    { kind: 'textContent', value: 'ביטול' },
    { kind: 'textContent', value: '✕' },
    { kind: 'ariaLabel', value: 'סגור' },
    { kind: 'ariaLabel', value: 'close' },
  ],
  /** Account selector/dropdown */
  accountSelector: [
    { kind: 'textContent', value: 'חשבון' },
    { kind: 'textContent', value: 'בחר חשבון' },
    { kind: 'textContent', value: 'חשבונות' },
    { kind: 'ariaLabel', value: 'בחר חשבון' },
  ],
  /** Dashboard/homepage indicators — successful login detection */
  dashboardIndicator: [
    { kind: 'textContent', value: 'שלום' },
    { kind: 'textContent', value: 'חשבון עו"ש' },
    { kind: 'textContent', value: 'תנועות אחרונות' },
    { kind: 'textContent', value: 'יתרה' },
    { kind: 'textContent', value: 'סך הכל' },
  ],
  /** Password change required indicators */
  changePasswordIndicator: [
    { kind: 'textContent', value: 'שינוי סיסמה' },
    { kind: 'textContent', value: 'חידוש סיסמה' },
    { kind: 'textContent', value: 'עדכון סיסמה' },
  ],
  /** Private customers / personal area navigation */
  privateCustomers: [
    { kind: 'textContent', value: 'לקוחות פרטיים' },
    { kind: 'textContent', value: 'אזור אישי' },
    { kind: 'textContent', value: 'כניסה עם סיסמה' },
  ],
  /** Transactions link/tab */
  transactionsLink: [
    { kind: 'textContent', value: 'תנועות' },
    { kind: 'textContent', value: 'פעולות' },
    { kind: 'textContent', value: 'תנועות אחרונות' },
    { kind: 'textContent', value: 'פירוט תנועות' },
  ],
  /** Skip/continue navigation */
  skipLink: [
    { kind: 'textContent', value: 'דלג' },
    { kind: 'textContent', value: 'דלג לחשבון' },
    { kind: 'textContent', value: 'המשך' },
  ],
  /** Balance display */
  balance: [
    { kind: 'textContent', value: 'יתרה' },
    { kind: 'textContent', value: 'סה"כ' },
    { kind: 'ariaLabel', value: 'יתרה' },
  ],
  /** Loading indicator */
  loadingIndicator: [
    { kind: 'ariaLabel', value: 'טוען' },
    { kind: 'textContent', value: 'טוען' },
  ],
  /** Date filter input */
  fromDateInput: [
    { kind: 'placeholder', value: 'מתאריך' },
    { kind: 'placeholder', value: 'מהתאריך' },
    { kind: 'placeholder', value: 'תאריך התחלה' },
    { kind: 'css', value: 'input[type="date"]' },
  ],
  /** ID verification form indicators (Max second-login) */
  idFormIndicator: [
    { kind: 'textContent', value: 'תעודת הזהות' },
    { kind: 'textContent', value: 'תעודת זהות' },
    { kind: 'textContent', value: 'ת.ז.' },
  ],
  /** Pending transactions tab/link */
  pendingTransactions: [
    { kind: 'textContent', value: 'פעולות עתידיות' },
    { kind: 'textContent', value: 'תנועות עתידיות' },
    { kind: 'textContent', value: 'המתנה' },
  ],
} satisfies Record<string, SelectorCandidate[]>;
