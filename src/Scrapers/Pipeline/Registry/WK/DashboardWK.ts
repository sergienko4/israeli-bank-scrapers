/**
 * Dashboard phase WK constants — errors, navigation, overlays, reveal.
 * Isolated: NO imports from Home, Login, or Scrape WK.
 */

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
    { kind: 'textContent', value: 'חשבון' },
    { kind: 'textContent', value: 'בחר חשבון' },
    { kind: 'textContent', value: 'חשבונות' },
    { kind: 'ariaLabel', value: 'בחר חשבון' },
  ],
  CHANGE_PWD: [
    { kind: 'textContent', value: 'שינוי סיסמה' },
    { kind: 'textContent', value: 'חידוש סיסמה' },
    { kind: 'textContent', value: 'עדכון סיסמה' },
    { kind: 'textContent', value: 'סיסמה פגה' },
  ],
  REVEAL: [
    { kind: 'regex', value: 'כניסתך האחרונה.*\\d{1,2}[./\\-]\\d{1,2}[./\\-]\\d{2,4}' },
    { kind: 'textContent', value: 'עסקאות וחיובים' },
    { kind: 'textContent', value: 'כל הפעולות' },
    { kind: 'textContent', value: 'חיובים ועסקאות' },
    { kind: 'textContent', value: 'חיפוש עסקאות וזיכויים' },
    { kind: 'textContent', value: 'החשבון שלי' },
    { kind: 'textContent', value: 'חיובים עתידיים' },
    { kind: 'textContent', value: 'צפייה בכרטיסים שלי' },
    { kind: 'textContent', value: 'יתרה בחשבון' },
  ],
  /** Menu expand triggers — collapsed menus that hide transaction links. */
  MENU_EXPAND: [
    { kind: 'textContent', value: 'פעולות' },
    { kind: 'textContent', value: 'עובר ושב' },
    { kind: 'textContent', value: 'עו"ש' },
    { kind: 'textContent', value: 'חשבון עו"ש' },
    { kind: 'textContent', value: 'פעולות נוספות' },
    { kind: 'textContent', value: 'תפריט' },
    { kind: 'textContent', value: 'שירות אונליין' },
    { kind: 'textContent', value: 'עסקאות וחיובים' },
    { kind: 'textContent', value: 'Menu' },
    { kind: 'ariaLabel', value: 'פעולות' },
    { kind: 'ariaLabel', value: 'תפריט' },
    { kind: 'ariaLabel', value: 'עוד' },
    { kind: 'ariaLabel', value: 'menu' },
  ],
  // Priority order: bank-account intent → card transactions → medium → generic.
  TRANSACTIONS: [
    { kind: 'ariaLabel', value: 'תנועות בחשבון' },
    { kind: 'clickableText', value: 'תנועות בחשבון' },
    { kind: 'clickableText', value: 'תנועות עו"ש' },
    { kind: 'clickableText', value: 'פירוט תנועות' },
    { kind: 'clickableText', value: 'לכל התנועות' },
    { kind: 'clickableText', value: 'תנועות אחרונות' },
    { kind: 'clickableText', value: 'לעובר ושב' },
    { kind: 'ariaLabel', value: 'עסקאות בכרטיס לפי מועד חיוב' },
    { kind: 'textContent', value: 'עסקאות בכרטיס לפי מועד חיוב' },
    { kind: 'clickableText', value: 'פירוט חיובים' },
    { kind: 'clickableText', value: 'חיובים ועסקאות' },
    { kind: 'textContent', value: 'פירוט חיובים' },
    { kind: 'textContent', value: 'עסקאות וחיובים' },
    { kind: 'clickableText', value: 'כל העסקאות' },
    { kind: 'clickableText', value: 'פירוט עסקאות' },
    { kind: 'textContent', value: 'עסקאות אחרונות' },
    { kind: 'ariaLabel', value: 'עסקאות' },
    { kind: 'ariaLabel', value: 'תנועות' },
    { kind: 'clickableText', value: 'עסקאות' },
    { kind: 'clickableText', value: 'תנועות' },
  ],
  SKIP: [
    { kind: 'textContent', value: 'דלג' },
    { kind: 'textContent', value: 'דלג לחשבון' },
    { kind: 'textContent', value: 'המשך' },
  ],
  BALANCE: [
    { kind: 'textContent', value: 'יתרה' },
    { kind: 'textContent', value: 'סה"כ' },
    { kind: 'ariaLabel', value: 'יתרה' },
  ],
  LOADING: [
    { kind: 'ariaLabel', value: 'טוען' },
    { kind: 'textContent', value: 'טוען' },
  ],
  DATE_FROM: [
    { kind: 'placeholder', value: 'מתאריך' },
    { kind: 'placeholder', value: 'מהתאריך' },
    { kind: 'placeholder', value: 'תאריך התחלה' },
  ],
  ID_FORM: [
    { kind: 'textContent', value: 'תעודת הזהות' },
    { kind: 'textContent', value: 'תעודת זהות' },
    { kind: 'textContent', value: 'ת.ז.' },
  ],
  PENDING: [
    { kind: 'textContent', value: 'פעולות עתידיות' },
    { kind: 'textContent', value: 'תנועות עתידיות' },
    { kind: 'textContent', value: 'המתנה' },
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
    { kind: 'textContent', value: 'סינון' },
    { kind: 'textContent', value: 'חיפוש' },
    { kind: 'textContent', value: 'סנן' },
    { kind: 'ariaLabel', value: 'סינון' },
    { kind: 'ariaLabel', value: 'חיפוש' },
    { kind: 'ariaLabel', value: 'filter' },
  ],
  /** Apply/show buttons — submits the date filter to fetch filtered data. */
  FILTER_APPLY: [
    { kind: 'textContent', value: 'הצג' },
    { kind: 'textContent', value: 'חפש' },
    { kind: 'textContent', value: 'הצג עסקאות' },
    { kind: 'textContent', value: 'הצג תנועות' },
    { kind: 'ariaLabel', value: 'הצג' },
  ],
  /** Success indicators — proves login completed and dashboard loaded. */
  SUCCESS: [
    { kind: 'regex', value: '^היי\\s+\\S+,\\s*.+!$' },
    { kind: 'regex', value: '^שלום\\s+\\S+' },
    { kind: 'regex', value: '^ברוך הבא,\\s+\\S+' },
    { kind: 'regex', value: '^Hello,?\\s+\\w+' },
    { kind: 'textContent', value: 'יציאה' },
    { kind: 'textContent', value: 'התנתק' },
    { kind: 'textContent', value: 'כניסתך האחרונה' },
    { kind: 'textContent', value: 'מצב החשבון' },
    { kind: 'textContent', value: 'יתרת עו"ש' },
    { kind: 'textContent', value: 'עסקאות וחיובים' },
    { kind: 'textContent', value: 'עסקאות אחרונות' },
    { kind: 'textContent', value: 'תנועות אחרונות' },
    { kind: 'textContent', value: 'יתרה' },
  ],
} as const;

export default WK_DASHBOARD;
