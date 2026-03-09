import type { Browser, Frame, Page } from 'playwright';

import { buildContextOptions } from '../../Common/Browser.js';
import { launchCamoufox } from '../../Common/CamoufoxLauncher.js';
import { runLoggedChain } from '../../Common/ChainLogger.js';
import { getDebug } from '../../Common/Debug.js';
import type { ILoginContext, INamedLoginStep } from '../../Common/LoginMiddleware.js';
import type { WaitUntilState } from '../../Common/Navigation.js';
import { ScraperProgressTypes } from '../../Definitions.js';
import { SCRAPER_CONFIGURATION } from '../Registry/ScraperConfig.js';
import BaseScraper from './BaseScraper.js';
import {
  type ILoginOptions,
  type ILoginResultContext,
  LOGIN_RESULTS,
  type LoginResults,
  type PossibleLoginResults,
  resolveAndBuildLoginResult,
} from './BaseScraperHelpers.js';
import type {
  IDefaultBrowserOptions,
  IScraperScrapingResult,
  ScraperCredentials,
} from './Interface.js';
import buildLoginChain from './LoginChainBuilder.js';
import type { ILoginStepContext } from './LoginSteps.js';
import { fillOneInput } from './LoginSteps.js';
import { handleNavigationFailure } from './NavigationRetry.js';
import ScraperError from './ScraperError.js';

export { type ILoginOptions, LOGIN_RESULTS, type LoginResults, type PossibleLoginResults };

const LOG = getDebug('base-scraper-with-browser');

/**
 * Run a cleanup function, swallowing errors to avoid masking earlier failures.
 * @param fn - The cleanup function to execute.
 * @returns True after the cleanup attempt completes.
 */
async function runCleanup(fn: () => Promise<boolean>): Promise<boolean> {
  try {
    await fn();
  } catch (e) {
    LOG.debug(`Cleanup function failed: ${(e as Error).message}`);
  }
  return true;
}

/**
 * Execute field-fill actions sequentially and return true when all complete.
 * @param actions - The array of async fill actions.
 * @returns True after all actions complete.
 */
async function runFieldActions(actions: (() => Promise<boolean>)[]): Promise<boolean> {
  const initialValue: Promise<boolean> = Promise.resolve(true);
  await actions.reduce<Promise<boolean>>(async (prev, action) => {
    await prev;
    return action();
  }, initialValue);
  return true;
}

/** Browser-based scraper base class — manages Playwright lifecycle and login chain. */
class BaseScraperWithBrowser<
  TCredentials extends ScraperCredentials,
> extends BaseScraper<TCredentials> {
  protected activeLoginContext: Page | Frame | null = null;

  protected page!: Page;

  private _cleanups: (() => Promise<boolean>)[] = [];

  private _otpPhoneHint = '';

  /**
   * Initialize the browser page and prepare the scraper for login.
   * @returns True when initialization completes.
   */
  public async initialize(): Promise<boolean> {
    await super.initialize();
    this.emitProgress(ScraperProgressTypes.Initializing);
    const page = await this.initializePage();
    if (!page) {
      LOG.debug('failed to initiate a browser page, exit');
      return true;
    }
    await this.setupPage(page);
    return true;
  }

  /**
   * Navigate to a URL with optional retry support for transient failures.
   * @param url - The URL to navigate to.
   * @param waitUntil - Playwright navigation wait strategy.
   * @param retries - Remaining retry attempts for non-403 failures.
   * @returns True when navigation succeeds.
   */
  public async navigateTo(
    url: string,
    waitUntil: WaitUntilState | undefined = 'load',
    retries = this.options.navigationRetryCount ?? 0,
  ): Promise<boolean> {
    const response = await this.gotoAndLog(url, waitUntil);
    if (response === null || response.ok()) return true;
    const status = response.status();
    const retryFn = this.buildRetryDelegate();
    return handleNavigationFailure({
      page: this.page,
      url,
      navOpts: { waitUntil },
      status,
      retries,
      log: LOG,
      navigateTo: retryFn,
    });
  }

  /**
   * Get bank-specific login options — must be overridden by each scraper.
   * @param credentials - The user's bank credentials.
   * @returns The login configuration for this bank.
   */
  public getLoginOptions(credentials: ScraperCredentials): ILoginOptions {
    void credentials;
    throw new ScraperError(`getLoginOptions() is not created in ${this.options.companyId}`);
  }

  /**
   * Fill multiple input fields on the login page.
   * @param pageOrFrame - The page or frame containing the inputs.
   * @param fields - The field descriptors with selectors and values.
   * @returns True when all fields are filled.
   */
  public async fillInputs(
    pageOrFrame: Page | Frame,
    fields: {
      selector: string;
      value: string;
      credentialKey?: string;
    }[],
  ): Promise<boolean> {
    const stepCtx = this.buildStepContext();
    /**
     * Build a fill action for one field.
     * @param field - The field descriptor.
     * @param field.selector - The CSS selector for the input.
     * @param field.value - The value to fill.
     * @param field.credentialKey - The credential key identifier.
     * @returns A deferred action that fills the input.
     */
    const toAction =
      (field: {
        selector: string;
        value: string;
        credentialKey?: string;
      }): (() => Promise<boolean>) =>
      () =>
        fillOneInput(stepCtx, pageOrFrame, field);
    const actions = fields.map(toAction);
    return runFieldActions(actions);
  }

  /**
   * Execute the full login chain and return the scraping result.
   * @param credentials - The user's bank credentials.
   * @returns The scraping result after login completes.
   */
  public async login(credentials: ScraperCredentials): Promise<IScraperScrapingResult> {
    this.activeLoginContext = null;
    const loginOptions = this.getLoginOptions(credentials);
    const { loginSetup } = SCRAPER_CONFIGURATION.banks[this.options.companyId];
    const ctx: ILoginContext = {
      page: this.page,
      activeFrame: this.page,
      loginSetup,
    };
    const stepCtx = this.buildStepContext();
    const steps: INamedLoginStep[] = buildLoginChain(stepCtx, loginOptions, ctx);
    const chainResult = await runLoggedChain(steps, ctx, LOG);
    if (chainResult !== null) return chainResult;
    const resultCtx = this.loginResultCtx();
    return resolveAndBuildLoginResult(resultCtx, loginOptions.possibleResults);
  }

  /**
   * Terminate the browser session and run all cleanup handlers.
   * @param isSuccess - Whether the scraping session was successful.
   * @returns True when termination completes.
   */
  public async terminate(isSuccess: boolean): Promise<boolean> {
    const successStr = String(isSuccess);
    LOG.debug('terminating browser with success = %s', successStr);
    this.emitProgress(ScraperProgressTypes.Terminating);
    await this.captureFailureScreenshot(isSuccess);
    const reversed = this._cleanups.reverse();
    const cleanupPromises = reversed.map(runCleanup);
    await Promise.all(cleanupPromises);
    this._cleanups = [];
    return true;
  }

  /**
   * Execute page.goto and log elapsed time.
   * @param url - The URL to navigate to.
   * @param waitUntil - Playwright wait strategy.
   * @returns The navigation response or null.
   */
  private async gotoAndLog(
    url: string,
    waitUntil: WaitUntilState | undefined,
  ): Promise<Awaited<ReturnType<Page['goto']>>> {
    const startMs = Date.now();
    const response = await this.page.goto(url, { waitUntil });
    if (response !== null) {
      const status = response.status();
      LOG.debug('navigateTo %s → %d (%dms)', url, status, Date.now() - startMs);
    }
    return response;
  }

  /**
   * Create a retry delegate that forwards to this.navigateTo.
   * @returns A navigation retry function for handleNavigationFailure.
   */
  private buildRetryDelegate(): (
    url: string,
    nav: { waitUntil?: WaitUntilState },
    retries: number,
  ) => Promise<boolean> {
    return (url, nav, retries) => this.navigateTo(url, nav.waitUntil, retries);
  }

  /**
   * Build the shared login step context for LoginSteps functions.
   * @returns The step context wrapping this scraper's state.
   */
  private buildStepContext(): ILoginStepContext {
    return {
      page: this.page,
      activeLoginContext: this.activeLoginContext,
      currentParsedPage: undefined,
      otpPhoneHint: this._otpPhoneHint,
      diagState: this.diagState,
      /**
       * Delegate progress events to the scraper.
       * @param type - The progress event type.
       * @returns True after emitting.
       */
      emitProgress: (type): boolean => {
        this.emitProgress(type);
        return true;
      },
      /**
       * Delegate navigation to the scraper.
       * @param url - The URL to navigate to.
       * @param waitUntil - The wait-until strategy.
       * @returns True when navigation succeeds.
       */
      navigateTo: (url, waitUntil) => this.navigateTo(url, waitUntil as WaitUntilState),
      /**
       * Delegate field filling to the scraper.
       * @param ctx - The page or frame context.
       * @param fields - The field descriptors.
       * @returns True when all fields are filled.
       */
      fillInputs: (ctx, fields) => this.fillInputs(ctx, fields),
      /**
       * Build the login result context from the scraper state.
       * @returns The login result context.
       */
      loginResultCtx: () => this.loginResultCtx(),
      options: this.options,
    };
  }

  /**
   * Build the login result context for result evaluation.
   * @returns The login result context with page and diagnostics.
   */
  private loginResultCtx(): ILoginResultContext {
    return {
      page: this.page,
      diagState: this.diagState,
      /**
       * Emit a progress event to listeners.
       * @param progressType - The progress type to emit.
       * @returns True after emitting.
       */
      emitProgress: (progressType): boolean => {
        this.emitProgress(progressType);
        return true;
      },
    };
  }

  /**
   * Configure the page with timeouts, interceptors, and event listeners.
   * @param page - The Playwright page to configure.
   * @returns True after configuration completes.
   */
  private async setupPage(page: Page): Promise<boolean> {
    this.page = page;
    this._cleanups.push(() => page.close().then(() => true));
    if (this.options.defaultTimeout) {
      this.page.setDefaultTimeout(this.options.defaultTimeout);
    }
    if (this.options.preparePage) {
      LOG.debug('execute preparePage interceptor provided in options');
      await this.options.preparePage(this.page);
    }
    this.page.on('requestfailed', request => {
      const errorText = request.failure()?.errorText ?? 'unknown';
      const failedUrl = request.url();
      LOG.debug('Request failed: %s %s', errorText, failedUrl);
    });
    return true;
  }

  /**
   * Create a new browser context and page from an existing browser.
   * @param browser - The Playwright browser instance.
   * @param isRegisterCleanup - Whether to register cleanup.
   * @returns A new Playwright page.
   */
  private async createContextAndPage(browser: Browser, isRegisterCleanup = true): Promise<Page> {
    const contextOpts = buildContextOptions();
    const context = await browser.newContext(contextOpts);
    if (isRegisterCleanup) {
      this._cleanups.push(() => context.close().then(() => true));
    }
    return context.newPage();
  }

  /**
   * Launch a new Camoufox browser instance and return a page.
   * @returns A new Playwright page from the launched browser.
   */
  private async launchNewBrowser(): Promise<Page> {
    const opts = this.options as IDefaultBrowserOptions;
    const { shouldShowBrowser } = opts;
    LOG.debug('launch Camoufox headless=%s', !shouldShowBrowser);
    const browser = await launchCamoufox(!shouldShowBrowser);
    this._cleanups.push(async () => {
      LOG.debug('closing the browser');
      await browser.close();
      return true;
    });
    if (opts.prepareBrowser) await opts.prepareBrowser(browser);
    return this.createContextAndPage(browser, false);
  }

  /**
   * Initialize a page from the configured browser source.
   * @returns A new Playwright page, or undefined on failure.
   */
  private async initializePage(): Promise<Page | undefined> {
    LOG.debug('initialize browser page');
    if ('browserContext' in this.options) {
      LOG.debug('Using the browser context provided in options');
      return this.options.browserContext.newPage();
    }
    if ('browser' in this.options) {
      return this.initializeFromExistingBrowser();
    }
    return this.launchNewBrowser();
  }

  /**
   * Initialize page from an existing browser instance.
   * @returns A new Playwright page.
   */
  private async initializeFromExistingBrowser(): Promise<Page> {
    LOG.debug('Using the browser instance provided in options');
    const opts = this.options as { browser: Browser; skipCloseBrowser?: boolean };
    const { browser } = opts;
    if (!opts.skipCloseBrowser) {
      this._cleanups.push(async () => {
        LOG.debug('closing the browser');
        await browser.close();
        return true;
      });
    }
    return this.createContextAndPage(browser);
  }

  /**
   * Capture a failure screenshot if configured and the session failed.
   * @param isSuccess - Whether the session was successful.
   * @returns True after screenshot capture attempt.
   */
  private async captureFailureScreenshot(isSuccess: boolean): Promise<boolean> {
    if (isSuccess || !this.options.storeFailureScreenShotPath) return true;
    LOG.debug('snapshot before terminate in %s', this.options.storeFailureScreenShotPath);
    await this.page
      .screenshot({ path: this.options.storeFailureScreenShotPath, fullPage: true })
      .catch((caught: unknown) => {
        const errMsg = (caught as Error).message.slice(0, 80);
        LOG.debug('screenshot failed: %s', errMsg);
      });
    return true;
  }
}

export { BaseScraperWithBrowser };
