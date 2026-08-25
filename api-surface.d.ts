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

interface ITransactionsAccount {
    accountNumber: string;
    balance?: number;
    txns: ITransaction[];
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
     * ISO date string
     */
    date: string;
    /**
     * ISO date string
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
    futureDebits?: IFutureDebit[];
    errorType?: ScraperErrorTypes;
    errorMessage?: string;
    errorDetails?: IWafErrorDetails;
    /** Long-term OTP token returned by banks that support it (e.g. OneZero).
     *  Save and pass as credentials.otpLongTermToken to skip SMS on future runs. */
    persistentOtpToken?: string;
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
     */
    shouldCombineInstallments?: boolean;
    /**
     * Adjust the page instance before it is being used.
     * @param page - The Playwright Page instance to configure.
     */
    preparePage?: (page: Page) => LifecyclePromise;
    /**
     * if set, store a screenshot if failed to scrape. Used for debug purposes
     */
    storeFailureScreenShotPath?: string;
    /**
     * if set, will set the timeout in milliseconds of `page.setDefaultTimeout`.
     */
    defaultTimeout?: number;
    /**
     * Options for manipulation of output data
     */
    outputData?: IOutputDataOptions;
    /**
     * Perform additional operation for each transaction to get more information (Like category) about it.
     * Please note: It will take more time to finish the process.
     */
    shouldAddTransactionInformation?: boolean;
    /**
     * Include the raw transaction object as received from the scraper source for debugging purposes.
     * @default false
     */
    includeRawTransaction?: boolean;
    /**
     * Adjust the viewport size of the browser page.
     * If not set, the default viewport size of 1024x768 will be used.
     */
    viewportSize?: {
        width: number;
        height: number;
    };
    /**
     * The number of times to retry the navigation in case of a failure (default 0)
     */
    navigationRetryCount?: number;
    /**
     * Opt-in features for the scrapers, allowing safe rollout of new breaking changes.
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

export { CompanyTypes, type IScraper, type IScraperLoginResult, type IScraperScrapingResult, SCRAPERS, type IScraperLoginResult as ScaperLoginResult, type IScraperScrapingResult as ScaperScrapingResult, type Scraper, type ScraperCredentials, type ScraperLoginResult, type ScraperOptions, type ScraperScrapingResult, createScraper };
