import { type Browser, type BrowserContext, type Page } from 'playwright';

import { type CompanyTypes, type ScraperProgressTypes } from '../Definitions';
import { type TransactionsAccount } from '../Transactions';
import { type ErrorResult, type ScraperErrorTypes, type WafErrorDetails } from './Errors';

// This union type exists because the scraper 'factory' returns a generic interface.
// Refactor when the factory returns concrete scraper types instead.
export type ScraperCredentials =
  | { userCode: string; password: string }
  | { username: string; password: string }
  | { id: string; password: string }
  | { id: string; password: string; num: string }
  | { id: string; password: string; card6Digits: string }
  | { username: string; nationalID: string; password: string }
  | ({ email: string; password: string } & (
      | {
          otpCodeRetriever: () => Promise<string>;
          phoneNumber: string;
        }
      | {
          otpLongTermToken: string;
        }
    ));

export type OptInFeatures =
  | 'isracard-amex:skipAdditionalTransactionInformation'
  | 'mizrahi:pendingIfNoIdentifier'
  | 'mizrahi:pendingIfHasGenericDescription'
  | 'mizrahi:isPendingIfTodayTransaction';

export interface FutureDebit {
  amount: number;
  amountCurrency: string;
  chargeDate?: string;
  bankAccountNumber?: string;
}

interface ExternalBrowserOptions {
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

interface ExternalBrowserContextOptions {
  /**
   * An externally managed browser context. This is useful when you want to manage the browser
   */
  browserContext: BrowserContext;
}

export interface DefaultBrowserOptions {
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
   * adjust the browser instance before it is being used
   *
   * @param browser
   */
  prepareBrowser?: (browser: Browser) => Promise<void>;
}

type ScraperBrowserOptions =
  | ExternalBrowserOptions
  | ExternalBrowserContextOptions
  | DefaultBrowserOptions;

export type ScraperOptions = ScraperBrowserOptions & {
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
   * adjust the page instance before it is being used.
   *
   * @param page
   */
  preparePage?: (page: Page) => Promise<void>;

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
  outputData?: OutputDataOptions;

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
  optInFeatures?: Array<OptInFeatures>;

  /**
   * Called when an OTP/2FA screen is detected after login form submission.
   * Return the one-time code to continue scraping automatically.
   * @param phoneHint masked phone number shown on the page, e.g. "*******1200" (empty string if none)
   */
  otpCodeRetriever?: (phoneHint: string) => Promise<string>;
};

export interface OutputDataOptions {
  /**
   * if true, the result wouldn't be filtered out by date, and you will return unfiltered scrapped data.
   */
  isFilterByDateEnabled?: boolean;
}

export interface ScraperScrapingResult {
  success: boolean;
  accounts?: TransactionsAccount[];
  futureDebits?: FutureDebit[];
  errorType?: ScraperErrorTypes;
  errorMessage?: string; // only on success=false
  errorDetails?: WafErrorDetails; // only on errorType=WAF_BLOCKED
  /** Long-term OTP token returned by banks that support it (e.g. OneZero).
   *  Save and pass as credentials.otpLongTermToken to skip SMS on future runs. */
  persistentOtpToken?: string;
}

export interface Scraper<TCredentials extends ScraperCredentials> {
  scrape(credentials: TCredentials): Promise<ScraperScrapingResult>;
  onProgress(
    func: (companyId: CompanyTypes, payload: { type: ScraperProgressTypes }) => void,
  ): void;
  triggerTwoFactorAuth(phoneNumber: string): Promise<ScraperTwoFactorAuthTriggerResult>;
  getLongTermTwoFactorToken(otpCode: string): Promise<ScraperGetLongTermTwoFactorTokenResult>;
}

export type ScraperTwoFactorAuthTriggerResult =
  | ErrorResult
  | {
      success: true;
    };

export type ScraperGetLongTermTwoFactorTokenResult =
  | ErrorResult
  | {
      success: true;
      longTermTwoFactorAuthToken: string;
    };

export interface ScraperLoginResult {
  success: boolean;
  errorType?: ScraperErrorTypes;
  errorMessage?: string; // only on success=false
  errorDetails?: WafErrorDetails; // only on errorType=WAF_BLOCKED
  persistentOtpToken?: string;
}
