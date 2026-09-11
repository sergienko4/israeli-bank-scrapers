import { Browser, BrowserContext, Page } from 'playwright-core';

declare enum CompanyTypes {
    Hapoalim = "hapoalim",
    Beinleumi = "beinleumi",
    Amex = "amex",
    Isracard = "isracard",
    VisaCal = "visaCal",
    Max = "max",
    OtsarHahayal = "otsarHahayal",
    Discount = "discount",
    Mercantile = "mercantile",
    Mizrahi = "mizrahi",
    Leumi = "leumi",
    Massad = "massad",
    Yahav = "yahav",
    Behatsdaa = "behatsdaa",
    BeyahadBishvilha = "beyahadBishvilha",
    OneZero = "oneZero",
    Pagi = "pagi",
    PayBox = "payBox",
    Pepper = "pepper"
}
declare const SCRAPERS: {
    hapoalim: {
        name: string;
        loginFields: string[];
    };
    leumi: {
        name: string;
        loginFields: string[];
    };
    mizrahi: {
        name: string;
        loginFields: string[];
    };
    discount: {
        name: string;
        loginFields: string[];
    };
    mercantile: {
        name: string;
        loginFields: string[];
    };
    otsarHahayal: {
        name: string;
        loginFields: string[];
    };
    max: {
        name: string;
        loginFields: string[];
    };
    visaCal: {
        name: string;
        loginFields: string[];
    };
    isracard: {
        name: string;
        loginFields: string[];
    };
    amex: {
        name: string;
        loginFields: string[];
    };
    beinleumi: {
        name: string;
        loginFields: string[];
    };
    massad: {
        name: string;
        loginFields: string[];
    };
    yahav: {
        name: string;
        loginFields: string[];
    };
    beyahadBishvilha: {
        name: string;
        loginFields: string[];
    };
    oneZero: {
        name: string;
        loginFields: string[];
    };
    behatsdaa: {
        name: string;
        loginFields: string[];
    };
    pagi: {
        name: string;
        loginFields: string[];
    };
    payBox: {
        name: string;
        loginFields: string[];
    };
    pepper: {
        name: string;
        loginFields: string[];
    };
};
declare enum ScraperProgressTypes {
    Initializing = "INITIALIZING",
    StartScraping = "START_SCRAPING",
    LoggingIn = "LOGGING_IN",
    LoginSuccess = "LOGIN_SUCCESS",
    LoginFailed = "LOGIN_FAILED",
    ChangePassword = "CHANGE_PASSWORD",
    EndScraping = "END_SCRAPING",
    Terminating = "TERMINATING"
}

/** Categorized error types returned by scrapers on failure. */
declare enum ScraperErrorTypes {
    TwoFactorRetrieverMissing = "TWO_FACTOR_RETRIEVER_MISSING",
    InvalidOtp = "INVALID_OTP",
    InvalidPassword = "INVALID_PASSWORD",
    /** Supplied `phoneNumber` cannot be normalised to the bank's wire format. */
    InvalidPhoneNumber = "INVALID_PHONE_NUMBER",
    ChangePassword = "CHANGE_PASSWORD",
    Timeout = "TIMEOUT",
    NetworkError = "NETWORK_ERROR",
    AccountBlocked = "ACCOUNT_BLOCKED",
    Generic = "GENERIC",
    /**
     * Legacy generic error type — kept for backwards-compatibility.
     * @deprecated Use `Generic` instead.
     */
    General = "GENERAL_ERROR",
    WafBlocked = "WAF_BLOCKED"
}

interface IWafErrorDetails {
    provider: 'cloudflare' | 'unknown';
    httpStatus: number;
    pageTitle: string;
    pageUrl: string;
    responseSnippet?: string;
    suggestions: string[];
}

interface IErrorResult {
    success: false;
    errorType: ScraperErrorTypes;
    errorMessage: string;
    errorDetails?: IWafErrorDetails;
}

/**
 * Async return type for lifecycle callbacks that perform side effects.
 * Wraps `Promise<void>` in a type alias to satisfy the no-restricted-syntax rule
 * that bans the `void` keyword in function return type annotations.
 */
type LifecyclePromise = Promise<void>;
/**
 * Type-level alias that resolves to void at compile time.
 * Used in callback parameter types where the return value is intentionally ignored.
 * Infers void from Promise without using the void keyword directly.
 */
type VoidResult = Promise<void> extends Promise<infer R> ? R : never;

interface IDefaultBrowserOptions {
    /**
     * shows the browser while scraping, good for debugging (default false)
     */
    shouldShowBrowser?: boolean;
    /**
     * provide a path to local chromium to be used by playwright
     */
    executablePath?: string;
    /**
     * additional arguments to pass to the browser instance. The list of flags can be found in
     *
     * https://developer.mozilla.org/en-US/docs/Mozilla/Command_Line_Options
     * https://peter.sh/experiments/chromium-command-line-switches/
     */
    args?: string[];
    /**
     * Maximum navigation time in milliseconds, pass 0 to disable timeout.
     * @default 30000
     */
    timeout?: number;
    /**
     * Adjust the browser instance before it is being used.
     * @param browser - The Playwright Browser instance to configure.
     */
    prepareBrowser?: (browser: Browser) => LifecyclePromise;
}

interface IOutputDataOptions {
    /**
     * if true, the result wouldn't be filtered out by date, and you will return unfiltered scrapped data.
     */
    isFilterByDateEnabled?: boolean;
}

interface IScraperLoginResult {
    success: boolean;
    errorType?: ScraperErrorTypes;
    errorMessage?: string;
    errorDetails?: IWafErrorDetails;
    persistentOtpToken?: string;
}

/**
 * What a scrape can honestly say about the window it was asked for.
 *
 * A caller asks for transactions since a date. Today the answer is a list, and
 * a list that is short because the bank had nothing older is indistinguishable
 * from a list that is short because the walk gave up. Both arrive as `success`.
 * This module names the difference so callers can act on it.
 *
 * Three states, each provable from evidence the scrape already holds:
 *
 * - `covered` — the oldest row reaches the requested start AND every loss
 *   channel the scrape watches came back clean.
 * - `lowerBoundReached` — the oldest row reaches the requested start, but at
 *   least one channel reported loss or could not run. Rows are missing or may
 *   be, and {@link IWindowLowerBoundReached.caveats} says which channel said so.
 * - `unproven` — the requested start was never reached at all.
 *
 * There is deliberately no fourth "probably fine" state. Every state here is
 * backed by something observed; none rests on an inference about what the
 * provider meant.
 */
/**
 * Why `covered` could not be claimed even though the start date was reached.
 *
 * Each member names a channel the scrape watches for row loss. All of them are
 * measured during the walk; none is inferred afterwards.
 *
 * `paginationStoppedEarly` means the paginated walk gave up while the provider
 * was still offering rows: it repeated a cursor or hit its page ceiling. A
 * shape's own "we have enough" stop does not raise this because sufficiency is
 * judged independently by the start-date test.
 */
type WindowCaveat = 'paginationStoppedEarly'
/** The provider declared more rows in a container than were present. */
 | 'declaredRowShortfall'
/** Rows were found in the response body that the bank shape did not return. */
 | 'extractionShortfall'
/** The extraction audit had nothing comparable to check against. */
 | 'extractionAuditUnavailable'
/** The mapper refused rows the shape had extracted. */
 | 'mappingRejectedRows'
/** The provider served rows outside the order the walk assumes. */
 | 'walkOrderViolated';
/**
 * Why the requested start was never reached.
 *
 * Every member is produced by a specific stop condition in the backfill loop
 * or by the classifier itself; there is no catch-all. A member that no code
 * path can reach is a lie the type system would help tell, so none is kept
 * "just in case".
 *
 * `noRowCarriedAUsableDate` means rows arrived, but none carried a date the
 * audit could read.
 */
type WindowUnprovenReason = 'noRowCarriedAUsableDate'
/** The caller's own `startDate` could not be read as a date. */
 | 'requestedStartUnreadable'
/** Backfill spent its ask ceiling without closing the gap. */
 | 'backfillCeilingReached'
/** This bank's request shape cannot express a narrower upper bound. */
 | 'backfillNotSupportedForBank'
/** Backfill was switched off for this run. */
 | 'backfillDisabled'
/** A narrowed ask returned nothing older, so the walk stopped advancing. */
 | 'boundDidNotMove';
/**
 * The requested start was reached and every watched channel was clean.
 *
 * <p>This does NOT promise that no row in the middle of the window was dropped
 * without leaving a trace. Detecting that needs a reliable provider total for
 * the complete requested window, which Israeli banks generally do not send. It
 * promises that the window's far edge was reached and that nothing the scrape
 * can observe reported loss along the way.
 */
interface IWindowCovered {
    readonly status: 'covered';
    /** The start the caller asked for, ISO 8601. */
    readonly requestedStart: string;
    /** The oldest row's calendar day in the bank's own zone, `YYYY-MM-DD`. */
    readonly oldest: string;
}
/** The requested start was reached, but a channel reported loss or could not run. */
interface IWindowLowerBoundReached {
    readonly status: 'lowerBoundReached';
    /** The start the caller asked for, ISO 8601. */
    readonly requestedStart: string;
    /** The oldest row's calendar day in the bank's own zone, `YYYY-MM-DD`. */
    readonly oldest: string;
    /** Every channel that blocked `covered`, in a stable order. Never empty. */
    readonly caveats: readonly WindowCaveat[];
}
/** The requested start was never reached. */
interface IWindowUnproven {
    readonly status: 'unproven';
    /** What stopped the walk short of the requested start. */
    readonly reason: WindowUnprovenReason;
    /** The start the caller asked for, ISO 8601, or `'invalid-date'` when unreadable. */
    readonly requestedStart: string;
    /** The oldest row's calendar day, `YYYY-MM-DD` — absent when no row carried one. */
    readonly oldest?: string;
    /** Whole days between the requested start and the oldest row, when both are known. */
    readonly gapDays?: number;
}
/** One account's verdict on the window the caller asked for. */
type IWindowCoverage = IWindowCovered | IWindowLowerBoundReached | IWindowUnproven;

interface ITransactionsAccount {
    accountNumber: string;
    balance?: number;
    txns: ITransaction[];
    /**
     * What this account can honestly claim about the window that was requested.
     *
     * <p>`txns` alone cannot answer it. A short list and a complete one are the
     * same shape, so a caller who receives thirty days after asking for ninety
     * has no way to tell a quiet account from a truncated one. This field is
     * that answer, per account, because the scrape's own window audit is
     * per-account.
     *
     * <p>Read {@link IWindowCoverage.status} first: `covered` means the start
     * was reached and every loss signal the scrape can observe was clean;
     * `lowerBoundReached` means the start was reached but something reported
     * loss or an extraction audit could not run (see `caveats`); `unproven`
     * means the start was never reached (see `reason`).
     *
     * <p>Even `covered` does not prove that no row in the *middle* of the window
     * was dropped silently — that needs a reliable provider total for the
     * complete requested window, which Israeli banks generally do not send.
     * See `src/WindowCoverage.ts` for the full contract.
     *
     * <p>Optional because only the Pipeline's API-direct scrapers run the audit.
     * Absent means "not assessed", never "assessed and fine".
     */
    windowCoverage?: IWindowCoverage;
}
declare enum TransactionTypes {
    Normal = "normal",
    Installments = "installments"
}
declare enum TransactionStatuses {
    Completed = "completed",
    Pending = "pending"
}
interface ITransactionInstallments {
    /**
     * the current installment number
     */
    number: number;
    /**
     * the total number of installments
     */
    total: number;
}
interface ITransaction {
    type: TransactionTypes;
    /**
     * sometimes called Asmachta
     */
    identifier?: string | number;
    /**
     * ISO-8601 date/date-time string.
     *
     * <p><b>Pipeline scrapers</b> emit a UTC instant. Most Israeli providers
     * state a *day* with no time and no offset; the Pipeline resolves such a
     * value to midnight of that day in the bank's calendar (`Asia/Jerusalem`), so
     * the instant is stable no matter what zone the scraper runs in.
     *
     * <p>That means the provider's stated day is **not** the UTC date prefix —
     * `2026-06-28T21:00:00.000Z` is the 29th in Israel. Read the day in the bank
     * calendar to recover it:
     *
     * ```ts
     * moment(txn.date).tz('Asia/Jerusalem').format('YYYY-MM-DD'); // '2026-06-29'
     * ```
     *
     * <p><b>Legacy (deprecated) scrapers</b> are frozen and are not covered by
     * that convention — some emit a bare `YYYY-MM-DD` day instead of an instant.
     * Parse defensively if you consume both families.
     *
     * @see docs/architecture/bank-calendar.md
     */
    date: string;
    /**
     * ISO-8601 date/date-time string. Same calendar convention, and the same
     * Legacy caveat, as {@link ITransaction.date}.
     */
    processedDate: string;
    originalAmount: number;
    originalCurrency: string;
    chargedAmount: number;
    chargedCurrency?: string;
    description: string;
    memo?: string;
    status: TransactionStatuses;
    installments?: ITransactionInstallments;
    category?: string;
    rawTransaction?: unknown;
}

interface IFutureDebit {
    amount: number;
    amountCurrency: string;
    chargeDate?: string;
    bankAccountNumber?: string;
}

interface IScraperDiagnostics {
    loginUrl: string;
    finalUrl?: string;
    loginDurationMs?: number;
    fetchDurationMs?: number;
    lastAction: string;
    pageTitle?: string;
    warnings: string[];
}

interface IScraperScrapingResult {
    success: boolean;
    accounts?: ITransactionsAccount[];
    /**
     * Upcoming debits.
     *
     * <p><b>Never populated.</b> The field is part of the upstream result shape
     * and is kept so the type stays compatible, but no scraper in this package
     * writes to it. An empty or absent value means "not available", not "this
     * account has no upcoming debits" — treating it as the latter would read a
     * gap in the implementation as a fact about someone's money.
     */
    futureDebits?: IFutureDebit[];
    errorType?: ScraperErrorTypes;
    errorMessage?: string;
    errorDetails?: IWafErrorDetails;
    /** Long-term OTP token returned by banks that support it (e.g. OneZero).
     *  Save and pass as credentials.otpLongTermToken to skip SMS on future runs. */
    persistentOtpToken?: string;
    /**
     * Per-run diagnostics.
     *
     * <p>Populated by the browser-based scrapers only. The API-direct pipeline
     * does not extend the base scraper that builds this, and reports what it
     * knows through `ITransactionsAccount.windowCoverage` instead.
     */
    diagnostics?: IScraperDiagnostics;
}

/**
 * Payload passed to ScraperOptions.onAuthFlowComplete. Both values
 * are nonempty strings when the callback fires; longTermToken is the
 * reusable seed (persist + feed back as creds.otpLongTermToken next
 * run) and bearer is the session token installed on the mediator.
 */
interface IAuthFlowInfo {
    readonly longTermToken: string;
    readonly bearer: string;
}
/**
 * Contract for the credential-side `otpCodeRetriever`.
 *
 * <p>By default the library calls it **at most once per login attempt**, even
 * when the bank's login chain submits the code in several requests (PayBox
 * submits it to both `/pinValidation` and `/loginBySms`). Implementations may
 * therefore be single-shot — consuming the inbound SMS, chat message or push
 * prompt — without needing their own cache.
 *
 * <p>One documented opt-out exists: a step declaring
 * `preHook.reuse: 'per-step'` acquires afresh, so a retriever CAN be called
 * again within the same flow. That is reserved for a bank that genuinely
 * delivers a distinct secret per step; no bank declares it today.
 *
 * <p>It IS called again for a genuinely new code when a login is retried after
 * the bank rejects the previous one.
 */
type ScraperCredentials = {
    userCode: string;
    password: string;
} | {
    username: string;
    password: string;
} | {
    username: string;
    password: string;
    id: string;
} | {
    id: string;
    password: string;
} | {
    id: string;
    password: string;
    num: string;
} | {
    id: string;
    password: string;
    card6Digits: string;
} | {
    username: string;
    nationalID: string;
    password: string;
} | {
    num: string;
    nationalID: string;
    password: string;
} | ({
    email: string;
    password: string;
} & ({
    otpCodeRetriever: () => Promise<string>;
    phoneNumber: string;
} | {
    otpLongTermToken: string;
})) | ({
    phoneNumber: string;
    password: string;
} & ({
    otpCodeRetriever: () => Promise<string>;
} | {
    otpLongTermToken: string;
}));
type OptInFeatures = 'isracard-amex:skipAdditionalTransactionInformation' | 'mizrahi:pendingIfNoIdentifier' | 'mizrahi:pendingIfHasGenericDescription' | 'mizrahi:isPendingIfTodayTransaction';
interface IExternalBrowserOptions {
    /**
     * An externally created browser instance.
     * you can get a browser directly from playwright via `chromium.launch()`
     *
     * Note: The browser will be closed by the library after the scraper finishes unless `skipCloseBrowser` is set to true
     */
    browser: Browser;
    /**
     * If true, the browser will not be closed by the library after the scraper finishes
     * @deprecated Read only by the Legacy (deprecated) scrapers. Every Pipeline bank ignores
     * this option, and `createScraper` emits a `ScraperOptionsWarning` when it is passed —
     * see {@link https://sergienko4.github.io/israeli-bank-scrapers/architecture/legacy/ Legacy (deprecated) scrapers}.
     */
    skipCloseBrowser?: boolean;
}
interface IExternalBrowserContextOptions {
    /**
     * An externally managed browser context. This is useful when you want to manage the browser
     */
    browserContext: BrowserContext;
}
type ScraperBrowserOptions = IExternalBrowserOptions | IExternalBrowserContextOptions | IDefaultBrowserOptions;
type ScraperOptions = ScraperBrowserOptions & {
    /**
     * The company you want to scrape
     */
    companyId: CompanyTypes;
    /**
     * include more debug info about in the output
     *
     * Not implemented: no scraper on either path reads this option. Use the
     * `FORENSIC_TRACE` capture for diagnostics instead —
     * see {@link https://sergienko4.github.io/israeli-bank-scrapers/observability/ Observability}.
     */
    verbose?: boolean;
    /**
     * the date to fetch transactions from (can't be before the minimum allowed time difference for the scraper)
     */
    startDate: Date;
    /**
     * scrape transactions to be processed X months in the future
     */
    futureMonthsToScrape?: number;
    /**
     * if set to true, all installment transactions will be combine into the first one
     * @deprecated Read only by the Legacy (deprecated) scrapers. Every Pipeline bank ignores
     * this option, and `createScraper` emits a `ScraperOptionsWarning` when it is passed —
     * see {@link https://sergienko4.github.io/israeli-bank-scrapers/architecture/legacy/ Legacy (deprecated) scrapers}.
     */
    shouldCombineInstallments?: boolean;
    /**
     * Adjust the page instance before it is being used.
     * @param page - The Playwright Page instance to configure.
     */
    preparePage?: (page: Page) => LifecyclePromise;
    /**
     * if set, store a screenshot if failed to scrape. Used for debug purposes
     * @deprecated Read only by the Legacy (deprecated) scrapers. Every Pipeline bank ignores
     * this option, and `createScraper` emits a `ScraperOptionsWarning` when it is passed —
     * see {@link https://sergienko4.github.io/israeli-bank-scrapers/architecture/legacy/ Legacy (deprecated) scrapers}.
     */
    storeFailureScreenShotPath?: string;
    /**
     * if set, will set the timeout in milliseconds of `page.setDefaultTimeout`.
     */
    defaultTimeout?: number;
    /**
     * Options for manipulation of output data
     * @deprecated Read only by the Legacy (deprecated) scrapers. Every Pipeline bank ignores
     * this option, and `createScraper` emits a `ScraperOptionsWarning` when it is passed —
     * see {@link https://sergienko4.github.io/israeli-bank-scrapers/architecture/legacy/ Legacy (deprecated) scrapers}.
     */
    outputData?: IOutputDataOptions;
    /**
     * Perform additional operation for each transaction to get more information (Like category) about it.
     * Please note: It will take more time to finish the process.
     * @deprecated Read only by the Legacy (deprecated) scrapers. Every Pipeline bank ignores
     * this option, and `createScraper` emits a `ScraperOptionsWarning` when it is passed —
     * see {@link https://sergienko4.github.io/israeli-bank-scrapers/architecture/legacy/ Legacy (deprecated) scrapers}.
     */
    shouldAddTransactionInformation?: boolean;
    /**
     * Include the raw transaction object as received from the scraper source for debugging purposes.
     * @default false
     * @deprecated Read only by the Legacy (deprecated) scrapers. Every Pipeline bank ignores
     * this option, and `createScraper` emits a `ScraperOptionsWarning` when it is passed —
     * see {@link https://sergienko4.github.io/israeli-bank-scrapers/architecture/legacy/ Legacy (deprecated) scrapers}.
     * For raw provider payloads on the Pipeline, use the `FORENSIC_TRACE` capture instead —
     * see {@link https://sergienko4.github.io/israeli-bank-scrapers/observability/redaction/ Forensic capture}.
     */
    includeRawTransaction?: boolean;
    /**
     * Adjust the viewport size of the browser page.
     *
     * Not implemented: no scraper on either path reads this option. The Pipeline
     * launches with `viewport: null` so the render surface follows the browser window.
     */
    viewportSize?: {
        width: number;
        height: number;
    };
    /**
     * The number of times to retry the navigation in case of a failure (default 0)
     * @deprecated Read only by the Legacy (deprecated) scrapers. Every Pipeline bank ignores
     * this option, and `createScraper` emits a `ScraperOptionsWarning` when it is passed —
     * see {@link https://sergienko4.github.io/israeli-bank-scrapers/architecture/legacy/ Legacy (deprecated) scrapers}.
     */
    navigationRetryCount?: number;
    /**
     * Opt-in features for the scrapers, allowing safe rollout of new breaking changes.
     * @deprecated Read only by the Legacy (deprecated) scrapers. Every Pipeline bank ignores
     * this option, and `createScraper` emits a `ScraperOptionsWarning` when it is passed —
     * see {@link https://sergienko4.github.io/israeli-bank-scrapers/architecture/legacy/ Legacy (deprecated) scrapers}.
     */
    optInFeatures?: OptInFeatures[];
    /**
     * Called when an OTP/2FA screen is detected after login form submission.
     * Return the one-time code to continue scraping automatically.
     *
     * Called at most once per successful acquisition per login attempt — see the
     * `otpCodeRetriever` contract note above `ScraperCredentials`. A single-shot
     * implementation (one SMS in, one code out) is sufficient for every bank
     * shipped today. Two documented exceptions can call it again within one
     * login: an acquisition that rejects is not cached, so a retry re-prompts;
     * and a step config may opt out with `preHook.reuse: 'per-step'`, which no
     * bank currently does.
     * @param phoneHint masked phone number shown on the page, e.g. "*******1200" (empty string if none)
     */
    otpCodeRetriever?: (phoneHint: string) => Promise<string>;
    /**
     * Invoked once by API-DIRECT-CALL banks after a successful auth flow
     * (either warm or cold path) to surface the captured long-term token
     * + bearer for caller-managed caching. Receiving a nonempty
     * longTermToken means the caller may persist it and pass it back as
     * creds.otpLongTermToken on the next run to skip the SMS steps.
     * Callback errors are logged and swallowed; scrape success is preserved.
     */
    onAuthFlowComplete?: (info: IAuthFlowInfo) => void | Promise<void>;
    /**
     * Maximum time (ms) to wait for the OTP code from the retriever callback.
     * If the retriever doesn't resolve within this window, the phase fails with OTP_TIMEOUT.
     * @default 180000 (3 minutes)
     */
    otpTimeoutMs?: number;
    /**
     * Login chain log verbosity.
     * - 'info' (default): chain plan, step pass/fail with timing, masked result summary.
     * - 'trace': all of info plus per-step context (URL, frames, selectors).
     * Falls back to LOG_LEVEL env var when not set.
     */
    loginLogLevel?: 'info' | 'trace';
    /**
     * Opt-in to the new Pipeline architecture.
     * When true, the factory routes to PipelineRegistry instead of the legacy scraper classes.
     * Both old and new code coexist — set to true to use the new pipeline for migrated banks.
     * @default false
     */
    usePipeline?: boolean;
};
interface IScraper<TCredentials extends ScraperCredentials> {
    scrape(credentials: TCredentials): Promise<IScraperScrapingResult>;
    onProgress(func: (companyId: CompanyTypes, payload: {
        type: ScraperProgressTypes;
    }) => VoidResult): VoidResult;
    triggerTwoFactorAuth(phoneNumber: string): Promise<ScraperTwoFactorAuthTriggerResult>;
    getLongTermTwoFactorToken(otpCode: string): Promise<ScraperGetLongTermTwoFactorTokenResult>;
}
type ScraperTwoFactorAuthTriggerResult = IErrorResult | {
    success: true;
};
type ScraperGetLongTermTwoFactorTokenResult = IErrorResult | {
    success: true;
    longTermTwoFactorAuthToken: string;
};
/**
 * Backward-compatible alias for IScraper. Prefer IScraper for new code.
 */
type Scraper<TCredentials extends ScraperCredentials = ScraperCredentials> = IScraper<TCredentials>;
/**
 * Backward-compatible alias for IScraperLoginResult. Prefer IScraperLoginResult for new code.
 */
type ScraperLoginResult = IScraperLoginResult;
/**
 * Backward-compatible alias for IScraperScrapingResult. Prefer IScraperScrapingResult for new code.
 */
type ScraperScrapingResult = IScraperScrapingResult;

/**
 * Create a scraper instance for the given company.
 * Pipeline-first: if the bank is in PIPELINE_REGISTRY, returns a PipelineScraper
 * regardless of the usePipeline flag. Falls back to the legacy registry otherwise.
 * @param options - Scraper configuration including company ID and credentials.
 * @returns A scraper instance ready to scrape transactions.
 */
declare function createScraper(options: ScraperOptions): IScraper<ScraperCredentials>;

export { CompanyTypes, type IScraper, type IScraperLoginResult, type IScraperScrapingResult, type IWindowCoverage, type IWindowCovered, type IWindowLowerBoundReached, type IWindowUnproven, SCRAPERS, type IScraperLoginResult as ScaperLoginResult, type IScraperScrapingResult as ScaperScrapingResult, type Scraper, type ScraperCredentials, type ScraperLoginResult, type ScraperOptions, type ScraperScrapingResult, type WindowCaveat, type WindowUnprovenReason, createScraper };
