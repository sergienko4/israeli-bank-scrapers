import { type CompanyTypes } from '../../Definitions';
import { type SelectorCandidate } from '../Base/LoginConfig';
import { BANKS } from './ScraperConfig.banks';
import { type IBankScraperConfig } from './ScraperConfig.types';

export type { IBankScraperConfig } from './ScraperConfig.types';

// ─── Central scraper configuration ───────────────────────────────────────────

export const SCRAPER_CONFIGURATION = {
  banks: BANKS,

  /** Global login-field fallback dictionary used by SelectorResolver on every bank */
  wellKnownSelectors: {
    username: [
      { kind: 'placeholder', value: 'שם משתמש' },
      { kind: 'placeholder', value: 'קוד משתמש' },
      { kind: 'placeholder', value: 'מספר לקוח' },
      { kind: 'placeholder', value: 'תז' },
      { kind: 'ariaLabel', value: 'שם משתמש' },
      { kind: 'ariaLabel', value: 'קוד משתמש' },
      { kind: 'name', value: 'username' },
      { kind: 'name', value: 'userCode' },
      { kind: 'css', value: '#username' }, // Beinleumi group, Yahav
      { kind: 'css', value: '#user-name' }, // Max
      { kind: 'css', value: '[formcontrolname="userName"]' }, // VisaCal (Angular Material)
      { kind: 'label', value: 'שם משתמש' }, // last-resort: find input by visible label text
      { kind: 'label', value: 'קוד משתמש' },
      { kind: 'label', value: 'מספר לקוח' },
      { kind: 'label', value: 'תז' },
      { kind: 'label', value: 'ת.ז.' },
      { kind: 'label', value: 'תעודת זהות' },
      { kind: 'label', value: 'שם משתמש' },
      { kind: 'label', value: 'קוד משתמש' },
      { kind: 'label', value: 'מספר זהות' },
    ],
    userCode: [
      { kind: 'placeholder', value: 'קוד משתמש' },
      { kind: 'placeholder', value: 'שם משתמש' },
      { kind: 'placeholder', value: 'מספר לקוח' },
      { kind: 'ariaLabel', value: 'קוד משתמש' },
      { kind: 'name', value: 'userCode' },
      { kind: 'name', value: 'username' },
      { kind: 'css', value: '#userCode' }, // Hapoalim
      { kind: 'label', value: 'קוד משתמש' },
      { kind: 'label', value: 'שם משתמש' },
      { kind: 'label', value: 'מספר לקוח' },
    ],
    password: [
      { kind: 'placeholder', value: 'סיסמה' },
      { kind: 'placeholder', value: 'סיסמא' },
      { kind: 'placeholder', value: 'קוד סודי' },
      { kind: 'ariaLabel', value: 'סיסמה' },
      { kind: 'name', value: 'password' },
      { kind: 'css', value: 'input[type="password"]' },
      { kind: 'css', value: '#password' }, // Hapoalim, Max, Beinleumi, Yahav
      { kind: 'css', value: '#loginPassword' }, // Behatsdaa, BeyahadBishvilha
      { kind: 'css', value: '#tzPassword' }, // Discount
      { kind: 'css', value: '[formcontrolname="password"]' }, // VisaCal (Angular Material)
      { kind: 'label', value: 'סיסמה' }, // last-resort: find input by visible label text
      { kind: 'label', value: 'קוד סודי' },
    ],
    id: [
      { kind: 'placeholder', value: 'תעודת זהות' },
      { kind: 'placeholder', value: 'מספר זהות' },
      { kind: 'placeholder', value: 'ת.ז' },
      { kind: 'ariaLabel', value: 'תעודת זהות' },
      { kind: 'name', value: 'id' },
      { kind: 'css', value: '#loginId' }, // Behatsdaa, BeyahadBishvilha
      { kind: 'css', value: '#tzId' }, // Discount
      { kind: 'label', value: 'תעודת זהות' }, // last-resort: find input by visible label text
      { kind: 'label', value: 'מספר זהות' }, // Discount #tzId label: "מספר זהות *"
      { kind: 'label', value: 'ת.ז' },
    ],
    nationalID: [
      { kind: 'placeholder', value: 'תעודת זהות' },
      { kind: 'placeholder', value: 'מספר זהות' },
      { kind: 'ariaLabel', value: 'תעודת זהות' },
      { kind: 'name', value: 'nationalID' },
      { kind: 'name', value: 'id' },
      { kind: 'css', value: '#pinno' }, // Yahav
      { kind: 'label', value: 'תעודת זהות' },
      { kind: 'label', value: 'מספר זהות' },
    ],
    card6Digits: [
      { kind: 'placeholder', value: '6 ספרות' },
      { kind: 'placeholder', value: 'ספרות הכרטיס' },
      { kind: 'ariaLabel', value: 'ספרות הכרטיס' },
      { kind: 'label', value: 'ספרות הכרטיס' },
      { kind: 'label', value: '6 ספרות' },
    ],
    num: [
      { kind: 'placeholder', value: 'מספר חשבון' },
      { kind: 'ariaLabel', value: 'מספר חשבון' },
      { kind: 'name', value: 'num' },
      { kind: 'css', value: '#aidnum' }, // Discount
      { kind: 'label', value: 'קוד מזהה' }, // Discount #aidnum label: "קוד מזהה *"
      { kind: 'label', value: 'מספר מנוי' },
      { kind: 'label', value: 'מספר חשבון' },
    ],
    otpCode: [
      { kind: 'placeholder', value: 'קוד חד פעמי' },
      { kind: 'placeholder', value: 'קוד SMS' },
      { kind: 'placeholder', value: 'קוד אימות' },
      { kind: 'placeholder', value: 'הזן קוד' },
      { kind: 'name', value: 'otpCode' },
      { kind: 'css', value: '#sendSms' }, // Beinleumi SMS trigger + input
      { kind: 'css', value: '#codeinput' }, // Beinleumi OTP input
    ],
    /** Universal submit-button fallback — tried after every bank's explicit submit candidate */
    __submit__: [
      { kind: 'css', value: 'button[type="submit"]' },
      { kind: 'ariaLabel', value: 'כניסה' },
      { kind: 'ariaLabel', value: 'התחברות' },
      { kind: 'ariaLabel', value: 'התחבר' },
      { kind: 'xpath', value: '//button[contains(., "כניסה")]' },
      { kind: 'xpath', value: '//button[contains(., "התחברות")]' },
      { kind: 'xpath', value: '//button[contains(., "התחבר")]' },
    ],
  } satisfies Record<string, SelectorCandidate[]>,

  /** Global dashboard-field fallback dictionary used by resolveDashboardField() */
  wellKnownDashboardSelectors: {
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
    /** Advanced search / filter opener — matched by visible display name */
    advancedSearchBtn: [
      { kind: 'ariaLabel', value: 'חיפוש מתקדם' },
      { kind: 'xpath', value: '//button[contains(., "חיפוש מתקדם")]' },
      { kind: 'xpath', value: '//a[contains(., "חיפוש מתקדם")]' },
    ],
    /** Date range radio button — matched by visible label text */
    dateRangeRadio: [
      { kind: 'ariaLabel', value: 'טווח תאריכים' },
      { kind: 'xpath', value: '//label[contains(., "טווח תאריכים")]' },
    ],
    /** Apply / show filter button — matched by visible display name, not HTML type */
    filterBtn: [
      { kind: 'ariaLabel', value: 'סנן' },
      { kind: 'ariaLabel', value: 'הצג' },
      { kind: 'xpath', value: '//button[contains(., "סנן")]' },
      { kind: 'xpath', value: '//button[contains(., "הצג")]' },
    ],
  } satisfies Record<string, SelectorCandidate[]>,

  /** OTP detection & interaction config — shared by OtpDetector and OtpHandler */
  otp: {
    /** Hebrew + English text patterns that indicate an OTP screen is shown */
    textPatterns: [
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
    ] as const,
    /** Matches masked phone numbers like ***1234 in OTP confirmation screens */
    phonePattern: /[*]{4,}\d{2,4}/,
    /** Submit-button candidates for the OTP confirmation step */
    submitSelectors: [
      { kind: 'xpath', value: '//button[contains(.,"אשר")]' },
      { kind: 'xpath', value: '//button[contains(.,"המשך")]' },
      { kind: 'xpath', value: '//button[contains(.,"אישור")]' },
      { kind: 'xpath', value: '//button[contains(.,"כניסה")]' },
      { kind: 'ariaLabel', value: 'כניסה' },
      { kind: 'css', value: 'button[type="submit"]' },
      { kind: 'css', value: 'input[type="button"]' },
    ] satisfies SelectorCandidate[],
    /** Buttons/inputs that trigger an SMS OTP to be sent */
    smsTriggerSelectors: [
      { kind: 'css', value: '#sendSms' },
      { kind: 'xpath', value: '//button[contains(.,"SMS")]' },
      { kind: 'ariaLabel', value: 'שלח SMS' },
      { kind: 'css', value: 'input[type="radio"][value="SMS"]' },
      { kind: 'xpath', value: '//button[contains(.,"שלח")]' },
      { kind: 'xpath', value: '//button[contains(.,"קבל קוד")]' },
    ] satisfies SelectorCandidate[],
  },
} as const;

/**
 * Returns the wrong-credential text patterns configured for the given bank.
 * Used by the base scraper layer to detect wrong credentials by reading page text.
 *
 * @param companyId - the bank company type to look up
 * @returns ordered list of Hebrew text substrings that appear when credentials are wrong
 */
export function getWrongCredentialTexts(companyId: CompanyTypes): readonly string[] {
  return SCRAPER_CONFIGURATION.banks[companyId].wrongCredentialTexts;
}

/**
 * Returns WAF-indicator URL substrings for a bank — URL patterns that signal a WAF redirect
 * when present in the page URL after the post-submit sleep (1.5s).
 *
 * @param companyId - the bank identifier to look up
 * @returns the ordered list of URL substrings that indicate a WAF/session redirect
 */
export function getWafReturnUrls(companyId: CompanyTypes): readonly string[] {
  const bank = SCRAPER_CONFIGURATION.banks[companyId] as IBankScraperConfig;
  return bank.wafReturnUrls ?? [];
}
