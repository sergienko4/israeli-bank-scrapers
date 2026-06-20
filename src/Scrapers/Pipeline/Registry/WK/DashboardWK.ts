/**
 * Dashboard phase WK constants — errors, navigation, overlays, reveal.
 * Isolated: NO imports from Home, Login, or Scrape WK.
 */

import type { SelectorCandidate } from '../../../Base/Config/LoginConfigTypes.js';

/** Selector-kind discriminator strings, lifted out of every literal entry. */
const KIND_TEXT_CONTENT = 'textContent' as const;
const KIND_ARIA_LABEL = 'ariaLabel' as const;
const KIND_REGEX = 'regex' as const;

/** Hebrew label "transactions and charges" — appears in REVEAL, MENU_EXPAND,
 *  TRANSACTIONS, and SUCCESS lists as a dashboard signal. */
const LABEL_TXN_AND_CHARGES = 'עסקאות וחיובים' as const;

/** Transactions/charges navigation candidates, priority-ordered: bank-account
 *  intent → card transactions → medium → generic. The exact-text
 *  "פירוט החיובים והעסקאות" (with definite articles) sits at the top to
 *  disambiguate Max's two near-identical dropdown items — "פירוט החיובים
 *  והעסקאות" (My Info → Charge details and transactions, the correct one) vs
 *  "פירוט חיובים ועסקאות" (My Card → wrong twin matched by the existing
 *  substring further down). Verified offline against captured dashboard HTML
 *  for all 7 banks: only Max has this element; no overlap. */
const DASHBOARD_TRANSACTIONS: readonly SelectorCandidate[] = [
  { kind: 'exactText', value: 'פירוט החיובים והעסקאות' },
  { kind: KIND_ARIA_LABEL, value: 'תנועות בחשבון' },
  { kind: 'clickableText', value: 'תנועות בחשבון' },
  { kind: 'clickableText', value: 'תנועות עו"ש' },
  { kind: 'clickableText', value: 'פירוט תנועות' },
  { kind: 'clickableText', value: 'לכל התנועות' },
  { kind: 'clickableText', value: 'תנועות אחרונות' },
  { kind: 'clickableText', value: 'לעובר ושב' },
  { kind: KIND_ARIA_LABEL, value: 'עסקאות בכרטיס לפי מועד חיוב' },
  { kind: KIND_TEXT_CONTENT, value: 'עסקאות בכרטיס לפי מועד חיוב' },
  { kind: 'clickableText', value: 'פירוט חיובים' },
  { kind: 'clickableText', value: 'חיובים ועסקאות' },
  { kind: KIND_TEXT_CONTENT, value: 'פירוט חיובים' },
  { kind: KIND_TEXT_CONTENT, value: LABEL_TXN_AND_CHARGES },
  { kind: 'clickableText', value: 'כל העסקאות' },
  { kind: 'clickableText', value: 'פירוט עסקאות' },
  { kind: KIND_TEXT_CONTENT, value: 'עסקאות אחרונות' },
  { kind: KIND_ARIA_LABEL, value: 'עסקאות' },
  { kind: KIND_ARIA_LABEL, value: 'תנועות' },
  { kind: 'clickableText', value: 'עסקאות' },
  { kind: 'clickableText', value: 'תנועות' },
];

/** Dashboard phase WK — post-authentication UI helpers. */
export const WK_DASHBOARD = {
  VALIDATION_HINTS: [
    'כניסה באמצעות',
    'שדה חובה',
    'יש להזין ערך',
    'הזינו',
    'לקוח יקר',
    'אנא השאר',
    'בחר',
  ] as const,
  ACCOUNT: [
    { kind: KIND_TEXT_CONTENT, value: 'חשבון' },
    { kind: KIND_TEXT_CONTENT, value: 'בחר חשבון' },
    { kind: KIND_TEXT_CONTENT, value: 'חשבונות' },
    { kind: KIND_ARIA_LABEL, value: 'בחר חשבון' },
  ],
  CHANGE_PWD: [
    { kind: KIND_TEXT_CONTENT, value: 'שינוי סיסמה' },
    { kind: KIND_TEXT_CONTENT, value: 'חידוש סיסמה' },
    { kind: KIND_TEXT_CONTENT, value: 'עדכון סיסמה' },
    { kind: KIND_TEXT_CONTENT, value: 'סיסמה פגה' },
  ],
  REVEAL: [
    { kind: KIND_REGEX, value: String.raw`כניסתך האחרונה.*\d{1,2}[./\-]\d{1,2}[./\-]\d{2,4}` },
    { kind: KIND_TEXT_CONTENT, value: LABEL_TXN_AND_CHARGES },
    { kind: KIND_TEXT_CONTENT, value: 'כל הפעולות' },
    { kind: KIND_TEXT_CONTENT, value: 'חיובים ועסקאות' },
    { kind: KIND_TEXT_CONTENT, value: 'חיפוש עסקאות וזיכויים' },
    { kind: KIND_TEXT_CONTENT, value: 'החשבון שלי' },
    { kind: KIND_TEXT_CONTENT, value: 'חיובים עתידיים' },
    { kind: KIND_TEXT_CONTENT, value: 'צפייה בכרטיסים שלי' },
    { kind: KIND_TEXT_CONTENT, value: 'יתרה בחשבון' },
  ],
  /** Menu expand triggers — collapsed menus that hide transaction links. */
  MENU_EXPAND: [
    { kind: KIND_TEXT_CONTENT, value: 'פעולות' },
    { kind: KIND_TEXT_CONTENT, value: 'עובר ושב' },
    { kind: KIND_TEXT_CONTENT, value: 'עו"ש' },
    { kind: KIND_TEXT_CONTENT, value: 'חשבון עו"ש' },
    { kind: KIND_TEXT_CONTENT, value: 'פעולות נוספות' },
    { kind: KIND_TEXT_CONTENT, value: 'תפריט' },
    { kind: KIND_TEXT_CONTENT, value: 'שירות אונליין' },
    { kind: KIND_TEXT_CONTENT, value: LABEL_TXN_AND_CHARGES },
    { kind: KIND_TEXT_CONTENT, value: 'Menu' },
    { kind: KIND_ARIA_LABEL, value: 'פעולות' },
    { kind: KIND_ARIA_LABEL, value: 'תפריט' },
    { kind: KIND_ARIA_LABEL, value: 'עוד' },
    { kind: KIND_ARIA_LABEL, value: 'menu' },
  ],
  TRANSACTIONS: DASHBOARD_TRANSACTIONS,
  SKIP: [
    { kind: KIND_TEXT_CONTENT, value: 'דלג' },
    { kind: KIND_TEXT_CONTENT, value: 'דלג לחשבון' },
    { kind: KIND_TEXT_CONTENT, value: 'המשך' },
  ],
  BALANCE: [
    { kind: KIND_TEXT_CONTENT, value: 'יתרה' },
    { kind: KIND_TEXT_CONTENT, value: 'סה"כ' },
    { kind: KIND_ARIA_LABEL, value: 'יתרה' },
  ],
  LOADING: [
    { kind: KIND_ARIA_LABEL, value: 'טוען' },
    { kind: KIND_TEXT_CONTENT, value: 'טוען' },
  ],
  DATE_FROM: [
    { kind: 'placeholder', value: 'מתאריך' },
    { kind: 'placeholder', value: 'מהתאריך' },
    { kind: 'placeholder', value: 'תאריך התחלה' },
  ],
  ID_FORM: [
    { kind: KIND_TEXT_CONTENT, value: 'תעודת הזהות' },
    { kind: KIND_TEXT_CONTENT, value: 'תעודת זהות' },
    { kind: KIND_TEXT_CONTENT, value: 'ת.ז.' },
  ],
  PENDING: [
    { kind: KIND_TEXT_CONTENT, value: 'פעולות עתידיות' },
    { kind: KIND_TEXT_CONTENT, value: 'תנועות עתידיות' },
    { kind: KIND_TEXT_CONTENT, value: 'המתנה' },
  ],
  TXN_PAGE_PATTERNS: [
    /\/transactions$/i,
    /\/transactions\b/i,
    /\/current-account\/transactions/i,
    /\/transactionlist/i,
    /\/ocp\/transactions/i,
  ] as readonly RegExp[],
  /** Filter trigger buttons — opens the date filter panel on transactions pages. */
  FILTER_TRIGGER: [
    { kind: KIND_TEXT_CONTENT, value: 'סינון' },
    { kind: KIND_TEXT_CONTENT, value: 'חיפוש' },
    { kind: KIND_TEXT_CONTENT, value: 'סנן' },
    { kind: KIND_ARIA_LABEL, value: 'סינון' },
    { kind: KIND_ARIA_LABEL, value: 'חיפוש' },
    { kind: KIND_ARIA_LABEL, value: 'filter' },
  ],
  /** Apply/show buttons — submits the date filter to fetch filtered data. */
  FILTER_APPLY: [
    { kind: KIND_TEXT_CONTENT, value: 'הצג' },
    { kind: KIND_TEXT_CONTENT, value: 'חפש' },
    { kind: KIND_TEXT_CONTENT, value: 'הצג עסקאות' },
    { kind: KIND_TEXT_CONTENT, value: 'הצג תנועות' },
    { kind: KIND_ARIA_LABEL, value: 'הצג' },
  ],
  /** Success indicators — proves login completed and dashboard loaded. */
  SUCCESS: [
    { kind: KIND_REGEX, value: String.raw`^היי\s+\S+,\s*.+!$` },
    { kind: KIND_REGEX, value: String.raw`^שלום\s+\S+` },
    { kind: KIND_REGEX, value: String.raw`^ברוך הבא,\s+\S+` },
    { kind: KIND_REGEX, value: String.raw`^Hello,?\s+\w+` },
    { kind: KIND_TEXT_CONTENT, value: 'יציאה' },
    { kind: KIND_TEXT_CONTENT, value: 'התנתק' },
    { kind: KIND_TEXT_CONTENT, value: 'כניסתך האחרונה' },
    { kind: KIND_TEXT_CONTENT, value: 'מצב החשבון' },
    { kind: KIND_TEXT_CONTENT, value: 'יתרת עו"ש' },
    { kind: KIND_TEXT_CONTENT, value: LABEL_TXN_AND_CHARGES },
    { kind: KIND_TEXT_CONTENT, value: 'עסקאות אחרונות' },
    { kind: KIND_TEXT_CONTENT, value: 'תנועות אחרונות' },
    { kind: KIND_TEXT_CONTENT, value: 'יתרה' },
  ],
} as const;

export default WK_DASHBOARD;
