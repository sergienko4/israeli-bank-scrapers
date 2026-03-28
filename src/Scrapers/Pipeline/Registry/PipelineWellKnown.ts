/**
 * Pipeline WellKnown (WK) — Phase-Aligned Instruction Set for the Login State Machine.
 *
 * Structure mirrors the pipeline execution order exactly:
 *
 *   WK.HOME.PRE.CLOSE_POPUP     — close overlays before navigating
 *   WK.HOME.ACTION.NAV_ENTRY    — home page → login URL (navigation links)
 *   WK.HOME.ACTION.NAV_REVEAL   — login page → unlock form (mode toggle, split pages)
 *   WK.HOME.POST.FORM_CHECK     — verify credential form is rendered
 *
 *   WK.LOGIN.PRE.FIELD_READY    — wait for form fields to be interactive
 *   WK.LOGIN.ACTION.FORM        — fill credential slots (id, password, mfa, num, submit)
 *   WK.LOGIN.ACTION.CONCEPT_MAP — translate credentialKey → FORM slot
 *   WK.LOGIN.POST.SUCCESS       — visual proof of post-login state
 *
 *   WK.DASHBOARD.*              — post-auth UI helpers (errors, overlays, navigation)
 *
 * Rule #14 (SOLID): Open for extension (add strings here), closed for modification.
 */

import type { SelectorCandidate } from '../../Base/Config/LoginConfig.js';

/** The valid slot names in WK.LOGIN.ACTION.FORM — declared here to avoid circular self-reference. */
type FormSlot = 'id' | 'password' | 'mfa' | 'num' | 'submit' | 'otpArea';

export const WK = {
  // ── SHARED: used by PRE step of every phase ──────────────────────────────────────
  //
  // Each PRE step MUST call tryClosePopup first — clears overlays before discovery.
  // Positioned at root because it is the one allowed ACTION inside any PRE step.

  CLOSE_POPUP: [
    { kind: 'textContent', value: 'סגור' },
    { kind: 'textContent', value: 'close' },
    { kind: 'textContent', value: 'ביטול' },
    { kind: 'textContent', value: '✕' },
    { kind: 'ariaLabel', value: 'סגור' },
    { kind: 'ariaLabel', value: 'close' },
  ],

  // ── HOME PHASE ───────────────────────────────────────────────────────────────────
  //
  // WK keys describe the CONCEPT — the step (PRE/ACTION/POST) determines usage:
  //
  //   HOME.PRE   — tryClosePopup(WK.CLOSE_POPUP) + DISCOVER login link
  //                [FindLoginLink, FindPrivateCustomers, FindCredentialArea]
  //
  //   HOME.ACTION — ACT on what PRE discovered
  //                [clickLoginLink, clickPrivateCustomers, clickCredentialArea]
  //
  //   HOME.POST  — VALIDATE navigation + form readiness
  //                [waitForCredentialsForm, waitForFirstField, checkReadiness]

  HOME: {
    /**
     * Login entry-point links on the public home page.
     * HOME.PRE uses these to DISCOVER the navigation element (resolveVisible).
     * HOME.ACTION uses them to ACT — click the discovered element (click).
     */
    ENTRY: [
      { kind: 'textContent', value: 'כניסה לחשבון' },
      { kind: 'textContent', value: 'כניסה לאיזור האישי' },
      { kind: 'textContent', value: 'כניסה והרשמה' },
      { kind: 'textContent', value: 'התחברות' },
      { kind: 'textContent', value: 'כניסה' },
      { kind: 'ariaLabel', value: 'כניסה לחשבון' },
    ],
    /**
     * Login-page unlock elements (mode toggle, Business/Private split).
     * HOME.PRE uses these to DISCOVER the unlock element (resolveVisible).
     * HOME.ACTION uses them to ACT — click the discovered element.
     * NOTE: Amex/Isracard portal hides these via UserWay (data-uw-hidden-control).
     */
    REVEAL: [
      // Business/Private split — e.g. Hapoalim
      { kind: 'textContent', value: 'לקוחות פרטיים' },
      { kind: 'textContent', value: 'אזור אישי' },
      { kind: 'textContent', value: 'כניסה עם סיסמה' },
      // Credential mode selector — password vs SMS/OTP (e.g. Amex, Isracard)
      { kind: 'textContent', value: 'כניסה לחשבון' },
      { kind: 'textContent', value: 'כניסה רגילה' },
      { kind: 'textContent', value: 'כניסה בסיסמה קבועה' },
      { kind: 'textContent', value: 'כניסה עם שם משתמש' },
      { kind: 'textContent', value: 'סיסמה קבועה' },
      { kind: 'ariaLabel', value: 'כניסה עם סיסמה קבועה' },
      { kind: 'ariaLabel', value: 'כניסה רגילה' },
    ],
    /**
     * Credential form field candidates for HOME.POST validation.
     * FIELD_READY: races these to confirm fields are visible + interactive.
     * FORM_CHECK:  probes for a specific field to confirm the form rendered.
     * Both used exclusively by HOME.POST — never by LOGIN phase.
     */
    FIELD_READY: [
      { kind: 'placeholder', value: 'תעודת זהות' },
      { kind: 'placeholder', value: 'מספר זהות' },
      { kind: 'placeholder', value: 'ת.ז' },
      { kind: 'placeholder', value: 'שם משתמש' },
      { kind: 'placeholder', value: 'קוד משתמש' },
      { kind: 'placeholder', value: 'סיסמה' },
      { kind: 'placeholder', value: 'קוד סודי' },
      { kind: 'labelText', value: 'תעודת זהות' },
      { kind: 'labelText', value: 'שם משתמש' },
      { kind: 'labelText', value: 'סיסמה' },
    ],
    FORM_CHECK: [
      { kind: 'labelText', value: 'תעודת זהות' },
      { kind: 'labelText', value: 'מספר זהות' },
      { kind: 'labelText', value: 'שם משתמש' },
      { kind: 'placeholder', value: 'תעודת זהות' },
      { kind: 'placeholder', value: 'שם משתמש' },
      { kind: 'placeholder', value: 'ת.ז' },
      { kind: 'name', value: 'id' },
      { kind: 'name', value: 'username' },
    ],
  },

  // ── LOGIN PHASE ──────────────────────────────────────────────────────────────────

  LOGIN: {
    /**
     * ACTION: fill the credential form.
     *
     * FORM: 5 semantic slots. Bank configs use CONCEPT_MAP to translate
     * credential object keys (e.g. 'card6Digits') to the correct slot (e.g. 'mfa').
     *
     * CONCEPT_MAP: routes credentialKey → FORM slot.
     *   Unknown keys (not in map) return undefined → Mediator uses empty candidates.
     */
    ACTION: {
      FORM: {
        /** Israeli national ID, username, account number, branch code. */
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
        /** Password, PIN, secret code. */
        password: [
          { kind: 'placeholder', value: 'סיסמה' },
          { kind: 'placeholder', value: 'סיסמא' },
          { kind: 'placeholder', value: 'קוד סודי' },
          { kind: 'labelText', value: 'סיסמה' },
          { kind: 'labelText', value: 'סיסמא' },
          { kind: 'labelText', value: 'קוד סודי' },
          { kind: 'ariaLabel', value: 'סיסמה' },
          { kind: 'name', value: 'password' },
        ],
        /** OTP code, SMS code, 6-digit card number. */
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
        /** Bank branch code / account code (distinct from national ID). */
        num: [
          { kind: 'labelText', value: 'קוד מזהה' },
          { kind: 'labelText', value: 'מספר חשבון' },
          { kind: 'placeholder', value: 'מספר חשבון' },
          { kind: 'ariaLabel', value: 'מספר חשבון' },
          { kind: 'name', value: 'num' },
          { kind: 'textContent', value: 'קוד מזהה' },
        ],
        /** Universal submit button fallback. */
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
        /** OTP area indicator — reveals OTP input (OtpPhase). */
        otpArea: [
          { kind: 'textContent', value: 'כניסה באמצעות SMS' },
          { kind: 'textContent', value: 'קוד חד פעמי' },
          { kind: 'textContent', value: 'שלח קוד לנייד' },
        ],
      } satisfies Record<string, readonly SelectorCandidate[]>,
    },

    /**
     * POST: visual proof that login succeeded.
     * DashboardPhase races these against URL change — solves the "SPA redirect" issue.
     * Ordered by confidence: personalised greetings → logout link → account content.
     */
    POST: {
      /** Race these indicators to confirm login — first match wins. */
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
    },
  },

  // ── DASHBOARD PHASE ──────────────────────────────────────────────────────────────

  /**
   * DASHBOARD: post-authentication UI helpers.
   * Only relevant AFTER login — NOT part of the login state machine.
   */
  DASHBOARD: {
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
    /** Validation hints that look like errors but are pre-submit form state. Ignore these. */
    VALIDATION_HINTS: [
      'כניסה באמצעות', // "Login via..." — form header
      'שדה חובה', // "Required field" — empty field marker
      'יש להזין ערך', // "Enter a value of required length" — length validation
      'הזינו', // "Enter..." — input prompt
      'לקוח יקר', // "Dear customer" — chat widget text
      'אנא השאר', // "Please leave" — chat widget CTA
      'בחר', // "Choose" — Angular Material dropdown placeholder
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
    TRANSACTIONS: [
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
  },
} as const;

// ── Concept map (sibling export — avoids circular reference inside WK) ───────────

/**
 * Translates a bank credentialKey to a WK.LOGIN.ACTION.FORM slot.
 * Keeps bank configs honest (credentialKey = actual credentials object key)
 * while routing element resolution to the correct semantic FORM slot.
 * Unknown keys return undefined → Mediator uses empty candidates.
 */
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

// ── API endpoint patterns ─────────────────────────────────────────────────────────

/** WellKnown API endpoint patterns — regex patterns for network discovery. */
export const PIPELINE_WELL_KNOWN_API = {
  accounts: [/userAccountsData/i, /account\/init/i, /account\/info/i, /DashboardMonth/i],
  transactions: [
    /transactionsDetails/i,
    /filteredTransactions/i,
    /CardsTransactionsList/i,
    /lastTransactions/i,
  ],
  balance: [/infoAndBalance/i, /dashboardBalances/i, /GetFrameStatus/i, /Frames.*api/i],
  auth: [
    /authentication\/login/i,
    /verification/i,
    /loginSuccess/i,
    /ValidateIdData/i,
    /performLogon/i,
  ],
  pending: [/approvals/i, /getClearanceRequests/i, /FutureTransaction/i],
} satisfies Record<string, RegExp[]>;

// ── Transaction field names ───────────────────────────────────────────────────────

const DISPLAY_ID_FIELDS = [
  'last4Digits',
  'AccountID',
  'accountNumber',
  'cardNumber',
  'bankAccountNum',
  'cardSuffix',
  'displayId',
  'cardLast4',
] as const;

const QUERY_ID_FIELDS = [
  'cardUniqueId',
  'cardUniqueID',
  'bankAccountUniqueID',
  'accountId',
  'CardId',
  'cardIndex',
] as const;

export const PIPELINE_WELL_KNOWN_RESPONSE_FIELDS = {
  responseStatus: ['Status', 'status', 'HeaderStatus', 'responseStatus'],
} satisfies Record<string, string[]>;

export const PIPELINE_WELL_KNOWN_TXN_FIELDS = {
  accountId: [...QUERY_ID_FIELDS, ...DISPLAY_ID_FIELDS],
  displayId: [...DISPLAY_ID_FIELDS],
  queryId: [...QUERY_ID_FIELDS],
  date: [
    'OperationDate',
    'trnPurchaseDate',
    'fullPurchaseDate',
    'date',
    'transactionDate',
    'txnDate',
  ],
  processedDate: ['ValueDate', 'debCrdDate', 'processedDate', 'billingDate', 'settlementDate'],
  amount: ['OperationAmount', 'trnAmt', 'dealSum', 'amount', 'chargedAmount', 'transactionAmount'],
  originalAmount: ['OperationAmount', 'amtBeforeConvAndIndex', 'originalAmount', 'dealSumOutbound'],
  description: [
    'OperationDescriptionToDisplay',
    'merchantName',
    'description',
    'transDesc',
    'memo',
  ],
  identifier: ['OperationNumber', 'trnIntId', 'identifier', 'id', 'referenceNumber', 'txnId'],
  currency: ['trnCurrencySymbol', 'currency', 'originalCurrency', 'currencyCode'],
  balance: ['AccountBalance', 'balance', 'nextTotalDebit', 'currentBalance'],
  fromDate: ['fromTransDate', 'fromDate', 'FromDate', 'startDate'],
  toDate: ['toTransDate', 'toDate', 'ToDate', 'endDate'],
} satisfies Record<string, string[]>;

export const PIPELINE_WELL_KNOWN_MONTHLY_FIELDS = {
  month: ['month', 'billingMonth', 'Month'],
  year: ['year', 'billingYear', 'Year'],
  accountId: [
    'cardUniqueId',
    'cardUniqueID',
    'bankAccountUniqueID',
    'accountId',
    'cardNumber',
    'CardId',
  ],
} satisfies Record<string, string[]>;
