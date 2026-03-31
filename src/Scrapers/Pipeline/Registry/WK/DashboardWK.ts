/**
 * Dashboard phase WK constants — errors, navigation, overlays, reveal.
 * Isolated: NO imports from Home, Login, or Scrape WK.
 */

/** Dashboard phase WK — post-authentication UI helpers. */
export const WK_DASHBOARD = {
  ERROR: [
    { kind: 'textContent', value: 'פרטים שגויים' },
    { kind: 'textContent', value: 'שכחת את הפרטים?' },
    { kind: 'textContent', value: 'שגיאה' },
    { kind: 'textContent', value: 'או לשחזר בקלות' },
    { kind: 'textContent', value: 'אחד או יותר מפרטי ההזדהות שמסרת שגויים' },
    { kind: 'textContent', value: 'פרטי ההתחברות שגויים' },
    { kind: 'textContent', value: 'שם המשתמש או הסיסמה שהוזנו שגויים' },
    { kind: 'textContent', value: 'תקינה' },
    { kind: 'textContent', value: 'אינם תואמים' },
  ],
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
    { kind: 'textContent', value: 'חיובים עתידיים' },
    { kind: 'textContent', value: 'צפייה בכרטיסים שלי' },
  ],
  TRANSACTIONS: [
    { kind: 'ariaLabel', value: 'עסקאות' },
    { kind: 'ariaLabel', value: 'תנועות' },
    { kind: 'textContent', value: 'חיובים ועסקאות' },
    { kind: 'textContent', value: 'כל העסקאות' },
    { kind: 'textContent', value: 'פירוט עסקאות' },
    { kind: 'textContent', value: 'עסקאות' },
    { kind: 'textContent', value: 'תנועות' },
    { kind: 'textContent', value: 'פעולות' },
    { kind: 'textContent', value: 'תנועות אחרונות' },
    { kind: 'textContent', value: 'פירוט תנועות' },
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
} as const;
export default WK_DASHBOARD;
