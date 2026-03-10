import { type Browser, type BrowserContext, type Page } from 'playwright';

import { type CompanyTypes, type ScraperProgressTypes } from '../../Definitions.js';
import { type IErrorResult } from './Errors.js';
import type { LifecyclePromise, VoidResult } from './Interfaces/CallbackTypes.js';
import type { IDefaultBrowserOptions } from './Interfaces/DefaultBrowserOptions.js';
import type { IOutputDataOptions } from './Interfaces/OutputDataOptions.js';
import type { IScraperLoginResult } from './Interfaces/ScraperLoginResult.js';
import type { IScraperScrapingResult } from './Interfaces/ScraperScrapingResult.js';

export type { IDefaultBrowserOptions } from './Interfaces/DefaultBrowserOptions.js';
export type { IErrorResult } from './Interfaces/ErrorResult.js';
export type { IFutureDebit } from './Interfaces/FutureDebit.js';
export type { IOutputDataOptions } from './Interfaces/OutputDataOptions.js';
export type { IScraperDiagnostics } from './Interfaces/ScraperDiagnostics.js';
export type { IScraperLoginResult } from './Interfaces/ScraperLoginResult.js';
export type { IScraperScrapingResult } from './Interfaces/ScraperScrapingResult.js';
export type { IWafErrorDetails } from './Interfaces/WafErrorDetails.js';

// This union type exists because the scraper 'factory' returns a generic interface.
// Refactor when the factory returns concrete scraper types instead.
export type ScraperCredentials =
  | { userCode: string; password: string }
  | { username: string; password: string }
  | { username: string; password: string; id: string } // Max: second-login flow with ID (ת.ז.)
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

type ScraperBrowserOptions =
  | IExternalBrowserOptions
  | IExternalBrowserContextOptions
  | IDefaultBrowserOptions;

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
   * @param phoneHint masked phone number shown on the page, e.g. "*******1200" (empty string if none)
   */
  otpCodeRetriever?: (phoneHint: string) => Promise<string>;

  /**
   * Login chain log verbosity.
   * - 'info' (default): chain plan, step pass/fail with timing, masked result summary.
   * - 'trace': all of info plus per-step context (URL, frames, selectors).
   * Falls back to LOG_LEVEL env var when not set.
   */
  loginLogLevel?: 'info' | 'trace';
};

export interface IScraper<TCredentials extends ScraperCredentials> {
  scrape(credentials: TCredentials): Promise<IScraperScrapingResult>;
  onProgress(
    func: (companyId: CompanyTypes, payload: { type: ScraperProgressTypes }) => VoidResult,
  ): VoidResult;
  triggerTwoFactorAuth(phoneNumber: string): Promise<ScraperTwoFactorAuthTriggerResult>;
  getLongTermTwoFactorToken(otpCode: string): Promise<ScraperGetLongTermTwoFactorTokenResult>;
}

export type ScraperTwoFactorAuthTriggerResult =
  | IErrorResult
  | {
      success: true;
    };

export type ScraperGetLongTermTwoFactorTokenResult =
  | IErrorResult
  | {
      success: true;
      longTermTwoFactorAuthToken: string;
    };

// Backward-compatible type aliases (v7.x names → I-prefixed equivalents)

/**
 * Backward-compatible alias for IScraper. Prefer IScraper for new code.
 */
export type Scraper<TCredentials extends ScraperCredentials = ScraperCredentials> =
  IScraper<TCredentials>;

/**
 * Backward-compatible alias for IScraperLoginResult. Prefer IScraperLoginResult for new code.
 */
export type ScraperLoginResult = IScraperLoginResult;

/**
 * Backward-compatible alias for IScraperScrapingResult. Prefer IScraperScrapingResult for new code.
 */
export type ScraperScrapingResult = IScraperScrapingResult;
