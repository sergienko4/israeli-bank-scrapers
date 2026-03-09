import { type SelectorCandidate } from '../Base/LoginConfig.js';

/**
 * Global login-field fallback dictionary used by SelectorResolver on every bank.
 * Order = middleware priority: visible text first, CSS last resort.
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
    // --- CSS last resort ---
    { kind: 'css', value: '#username' }, // Beinleumi group, Yahav
    { kind: 'css', value: '#user-name' }, // Max
    { kind: 'css', value: '#userNumberDesktopHeb' }, // Mizrahi
    { kind: 'css', value: '[formcontrolname="userName"]' }, // VisaCal
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
    // --- CSS last resort ---
    { kind: 'css', value: '#userCode' }, // Hapoalim
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
    // --- CSS last resort ---
    { kind: 'css', value: 'input[type="password"]' },
    { kind: 'css', value: '#password' }, // Hapoalim, Max, Beinleumi, Yahav
    { kind: 'css', value: '#loginPassword' }, // Behatsdaa, BeyahadBishvilha
    { kind: 'css', value: '#tzPassword' }, // Discount
    { kind: 'css', value: '#passwordDesktopHeb' }, // Mizrahi
    { kind: 'css', value: '[formcontrolname="password"]' }, // VisaCal
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
    // --- CSS last resort ---
    { kind: 'css', value: '#loginId' }, // Behatsdaa, BeyahadBishvilha
    { kind: 'css', value: '#tzId' }, // Discount
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
    // --- CSS last resort ---
    { kind: 'css', value: '#pinno' }, // Yahav
  ],
  card6Digits: [
    // --- visible text ---
    { kind: 'labelText', value: 'ספרות' },
    { kind: 'placeholder', value: '6 ספרות' },
    { kind: 'placeholder', value: 'ספרות הכרטיס' },
    { kind: 'ariaLabel', value: 'ספרות הכרטיס' },
  ],
  num: [
    // --- visible text ---
    { kind: 'labelText', value: 'קוד מזהה' },
    { kind: 'labelText', value: 'מספר חשבון' },
    { kind: 'placeholder', value: 'מספר חשבון' },
    { kind: 'ariaLabel', value: 'מספר חשבון' },
    // --- semantic HTML ---
    { kind: 'name', value: 'num' },
    // --- CSS last resort ---
    { kind: 'css', value: '#aidnum' }, // Discount
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
    // --- CSS last resort ---
    { kind: 'css', value: 'button[type="submit"]' },
  ],
} satisfies Record<string, SelectorCandidate[]>;

/** Global dashboard-field fallback dictionary used by resolveDashboardField(). */
export const WELL_KNOWN_DASHBOARD_SELECTORS = {
  balance: [
    { kind: 'css', value: '.balance' },
    { kind: 'css', value: '[data-testid="balance"]' },
    { kind: 'ariaLabel', value: 'יתרה' },
    { kind: 'ariaLabel', value: 'balance' },
  ],
  loadingIndicator: [
    { kind: 'css', value: '.react-loading.hide' },
    { kind: 'css', value: '[data-loading]' },
    { kind: 'css', value: '.spinner' },
  ],
  /** Generic date-from filter input — Hebrew placeholder variants + HTML5 date input */
  fromDateInput: [
    { kind: 'placeholder', value: 'מתאריך' },
    { kind: 'placeholder', value: 'מהתאריך' },
    { kind: 'placeholder', value: 'תאריך התחלה' },
    { kind: 'css', value: 'input[type="date"]' },
  ],
  /** Generic loading spinner — Yahav, generic patterns */
  loadingSpinner: [
    { kind: 'css', value: '.loading-bar-spinner' },
    { kind: 'css', value: '.loading' },
    { kind: 'css', value: '[role="progressbar"]' },
  ],
} satisfies Record<string, SelectorCandidate[]>;
