import type { Browser, Frame, Page } from 'playwright';
import { chromium } from 'playwright-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';

import { buildContextOptions } from '../../Common/Browser';
import { getDebug } from '../../Common/Debug';
import { clickButton, fillInput, waitUntilElementFound } from '../../Common/ElementsInteractions';
import { getCurrentUrl, waitForNavigation, type WaitUntilState } from '../../Common/Navigation';
import { handleOtpStep } from '../../Common/OtpHandler';
import waitForPageStability from '../../Common/PageStability';
import { resolveFieldContext } from '../../Common/SelectorResolver';
import { sleep } from '../../Common/Waiting';
import { ScraperProgressTypes } from '../../Definitions';
import { BaseScraper } from './BaseScraper';
import {
  buildFieldConfig,
  buildHeadlessArgs,
  detectGenericInvalidPassword,
  getKeyByValue,
  isStuckOnLoginPage,
  LOGIN_RESULTS,
  type LoginOptions,
  type LoginResults,
  type PossibleLoginResults,
  retryOn403,
  safeCleanup,
} from './BaseScraperHelpers';
import { ScraperErrorTypes } from './Errors';
import type { DefaultBrowserOptions, ScraperCredentials, ScraperScrapingResult } from './Interface';
import { ScraperWebsiteChangedError } from './ScraperWebsiteChangedError';

const STEALTH_PLUGIN = StealthPlugin();
chromium.use(STEALTH_PLUGIN);

export { LOGIN_RESULTS, type LoginOptions, type LoginResults, type PossibleLoginResults };

const LOG = getDebug('base-scraper-with-browser');

/**
 * Base scraper that drives a Playwright browser for bank login and navigation.
 * Extend this class (or GenericBankScraper) for each bank scraper implementation.
 */
class BaseScraperWithBrowser<
  TCredentials extends ScraperCredentials,
> extends BaseScraper<TCredentials> {
  protected activeLoginContext: Page | Frame | null = null;

  protected page!: Page;

  private _cleanups: (() => Promise<void>)[] = [];

  /**
   * Initializes the scraper by launching a browser and creating a page.
   *
   * @returns a promise that resolves when the browser page is ready
   */
  public async initialize(): Promise<void> {
    await super.initialize();
    this.emitProgress(ScraperProgressTypes.Initializing);
    const page = await this.initializePage();
    if (!page) {
      LOG.info('failed to initiate a browser page, exit');
      return;
    }
    await this.setupPage(page);
  }

  /**
   * Navigates the browser to a URL, retrying on non-200/403 responses.
   *
   * @param url - the target URL to navigate to
   * @param waitUntil - when to consider navigation done (default: 'load')
   * @param retries - number of additional retry attempts on failure
   * @returns a promise that resolves when navigation is complete
   */
  public async navigateTo(
    url: string,
    waitUntil: WaitUntilState | undefined = 'load',
    retries = this.options.navigationRetryCount ?? 0,
  ): Promise<void> {
    const startMs = Date.now();
    const response = await this.page.goto(url, { waitUntil });
    if (response === null) return;
    const status = response.status();
    LOG.info('navigateTo %s → %d (%dms)', url, status, Date.now() - startMs);
    if (response.ok()) return;
    if (status === 403) return retryOn403({ page: this.page, url, waitUntil });
    if (retries > 0) {
      LOG.info('navigateTo %s → %d, retrying (%d left)', url, status, retries);
      return this.navigateTo(url, waitUntil, retries - 1);
    }
    const navError = `Failed to navigate: ${url} (${String(status)})`;
    throw new ScraperWebsiteChangedError('BaseScraperWithBrowser', navError);
  }

  /**
   * Returns the login configuration for this scraper. Override in each bank subclass.
   *
   * @param credentials - bank login credentials to embed in the login options
   * @returns the login options describing URL, fields, and result conditions
   */
  public getLoginOptions(credentials: ScraperCredentials): LoginOptions {
    void credentials;
    throw new ScraperWebsiteChangedError(
      this.options.companyId,
      'getLoginOptions() not implemented',
    );
  }

  /**
   * Fills multiple form inputs sequentially, using SelectorResolver for each field.
   * @param pageOrFrame - the page or iframe containing the input fields
   * @param fields - field descriptors with CSS selector and value to type
   */
  public async fillInputs(
    pageOrFrame: Page | Frame,
    fields: { selector: string; value: string; credentialKey?: string }[],
  ): Promise<void> {
    const initialPromise = Promise.resolve();
    await fields.reduce(async (prev, field) => {
      await prev;
      await this.fillOneInput(pageOrFrame, field);
    }, initialPromise);
  }

  /**
   * Performs the browser-based login, retrying once if stuck on the login page.
   *
   * @param credentials - bank login credentials
   * @returns the login result or an error result on failure
   */
  public async login(credentials: ScraperCredentials): Promise<ScraperScrapingResult> {
    const loginOptions = this.getLoginOptions(credentials);
    try {
      return await this.attemptLogin(loginOptions);
    } catch (err) {
      const currentPageUrl = this.safePageUrl();
      if (isStuckOnLoginPage(currentPageUrl, loginOptions.loginUrl)) {
        LOG.info('login: stuck on login URL — retrying once');
        this.activeLoginContext = null;
        return this.attemptLogin(loginOptions);
      }
      throw err;
    }
  }

  /**
   * Closes all browser contexts and pages, optionally saving a failure screenshot.
   *
   * @param _success - whether the scraping completed successfully
   */
  public async terminate(_success: boolean): Promise<void> {
    LOG.info(`terminating browser with success = ${String(_success)}`);
    this.emitProgress(ScraperProgressTypes.Terminating);
    if (!_success && !!this.options.storeFailureScreenShotPath) {
      LOG.info('snapshot before terminate in %s', this.options.storeFailureScreenShotPath);
      await this.page
        .screenshot({ path: this.options.storeFailureScreenShotPath, fullPage: true })
        .catch((e: unknown) => {
          const errorSnippet = (e as Error).message.slice(0, 80);
          LOG.info('screenshot failed: %s', errorSnippet);
        });
    }
    const cleanupTasks = this._cleanups.reverse().map(safeCleanup);
    await Promise.all(cleanupTasks);
    this._cleanups = [];
  }

  /**
   * Returns the current page URL without throwing if the page is closed.
   * @returns the current URL or an empty string if unavailable
   */
  private safePageUrl(): string {
    try {
      return this.page.url();
    } catch {
      return '';
    }
  }

  /**
   * Attempts the full login flow: navigate → fill → submit → OTP → result.
   *
   * @param loginOptions - login configuration with URL, fields, and result conditions
   * @returns the login result
   */
  private async attemptLogin(loginOptions: LoginOptions): Promise<ScraperScrapingResult> {
    this.activeLoginContext = null;
    await this.prepareLoginPage(loginOptions);
    let loginFrameOrPage: Page | Frame | null = this.page;
    if (loginOptions.preAction) loginFrameOrPage = (await loginOptions.preAction()) ?? this.page;
    await this.submitLoginForm(loginOptions, loginFrameOrPage);
    const earlyResult = await this.checkOtpAndNavigate(loginOptions);
    if (earlyResult !== null) return earlyResult;
    const current = await getCurrentUrl(this.page, true);
    this.diagState.finalUrl = current;
    this.diagState.pageTitle = await this.page.title().catch(() => '');
    let loginResult = await getKeyByValue(loginOptions.possibleResults, current, this.page);
    if (
      loginResult === LOGIN_RESULTS.UnknownError &&
      (await detectGenericInvalidPassword(this.page))
    )
      loginResult = LOGIN_RESULTS.InvalidPassword;
    return this.handleLoginResult(loginResult);
  }

  /**
   * Fills a single input field using SelectorResolver with a CSS fallback.
   *
   * @param pageOrFrame - the page or iframe containing the input
   * @param field - field descriptor for the input to fill
   * @param field.selector - CSS selector for the input element
   * @param field.value - the text to type into the input
   * @param field.credentialKey - optional override for SelectorResolver credential key
   */
  private async fillOneInput(
    pageOrFrame: Page | Frame,
    field: { selector: string; value: string; credentialKey?: string },
  ): Promise<void> {
    const fc = buildFieldConfig(field);
    const currentPageUrl = this.page.url();
    const result = await resolveFieldContext(
      this.activeLoginContext ?? pageOrFrame,
      fc,
      currentPageUrl,
    );
    if (result.isResolved) {
      this.activeLoginContext = result.context;
      await fillInput(result.context, result.selector, field.value);
    } else {
      await fillInput(this.activeLoginContext ?? pageOrFrame, field.selector, field.value);
    }
  }

  /**
   * Configures the page with timeouts, preparePage hook, and request-failure logging.
   *
   * @param page - the newly created Playwright page to configure
   */
  private async setupPage(page: Page): Promise<void> {
    this.page = page;
    this._cleanups.push(() => page.close());
    if (this.options.defaultTimeout) this.page.setDefaultTimeout(this.options.defaultTimeout);
    if (this.options.preparePage) {
      LOG.info("execute 'preparePage' interceptor provided in options");
      await this.options.preparePage(this.page);
    }
    this.page.on('requestfailed', request => {
      const failureText = request.failure()?.errorText;
      const requestUrl = request.url();
      LOG.info('Request failed: %s %s', failureText, requestUrl);
    });
  }

  /**
   * Creates a new browser context with Hebrew locale settings and returns a fresh page.
   *
   * @param browser - the Playwright Browser instance to create the context in
   * @param registerContextCleanup - whether to register a cleanup to close the context on terminate
   * @returns a new Playwright Page in a fresh context
   */
  private async createContextAndPage(
    browser: Browser,
    registerContextCleanup = true,
  ): Promise<Page> {
    const contextOptions = buildContextOptions();
    const context = await browser.newContext(contextOptions);
    if (registerContextCleanup) this._cleanups.push(async () => context.close());
    return context.newPage();
  }

  /**
   * Registers a cleanup function to close the browser when terminate() is called.
   *
   * @param browser - the Playwright Browser to close during cleanup
   */
  private registerBrowserCleanup(browser: Browser): void {
    this._cleanups.push(async () => {
      LOG.info('closing the browser');
      await browser.close();
    });
  }

  /**
   * Launches a new Chromium browser with configured headless/visible settings.
   *
   * @returns a new Playwright Page ready for use
   */
  private async launchNewBrowser(): Promise<Page> {
    const opts = this.options as DefaultBrowserOptions;
    const { timeout, args = [], executablePath, shouldShowBrowser } = opts;
    const isHeadless = !shouldShowBrowser;
    LOG.info(`launch a browser with headless mode = ${String(isHeadless)}`);
    if ('executablePath' in this.options && this.options.executablePath) {
      const msg =
        'Custom executablePath is not supported. Use: npx playwright install chromium --with-deps';
      throw new ScraperWebsiteChangedError('BaseScraperWithBrowser', msg);
    }
    const browser = await chromium.launch({
      headless: isHeadless,
      executablePath,
      args: [...buildHeadlessArgs(isHeadless), ...args],
      timeout,
    });
    this.registerBrowserCleanup(browser);
    if (opts.prepareBrowser) await opts.prepareBrowser(browser);
    return this.createContextAndPage(browser, false);
  }

  /**
   * Creates the initial browser page from a provided context, browser, or a new launch.
   *
   * @returns the initialized Playwright Page, or undefined on failure
   */
  private async initializePage(): Promise<Page | undefined> {
    LOG.info('initialize browser page');
    if ('browserContext' in this.options) {
      LOG.info('Using the browser context provided in options');
      return this.options.browserContext.newPage();
    }
    if ('browser' in this.options) {
      LOG.info('Using the browser instance provided in options');
      const { browser } = this.options;
      if (!this.options.skipCloseBrowser) this.registerBrowserCleanup(browser);
      return this.createContextAndPage(browser);
    }
    return this.launchNewBrowser();
  }

  /**
   * Navigates to the login URL and waits for the page to be ready for input.
   *
   * @param loginOptions - login configuration specifying the URL and readiness check
   */
  private async prepareLoginPage(loginOptions: LoginOptions): Promise<void> {
    this.diagState.loginUrl = loginOptions.loginUrl;
    await this.navigateTo(loginOptions.loginUrl, loginOptions.waitUntil);
    if (loginOptions.checkReadiness) {
      await loginOptions.checkReadiness();
    } else if (typeof loginOptions.submitButtonSelector === 'string') {
      await waitUntilElementFound(this.page, loginOptions.submitButtonSelector);
    }
    const readinessPageUrl = this.page.url();
    LOG.info('login[2/5] checkReadiness passed url=%s', readinessPageUrl);
  }

  /**
   * Fills in the login form fields and clicks the submit button.
   *
   * @param loginOptions - login configuration with fields and submit button selector
   * @param loginFrameOrPage - the page or iframe containing the login form
   */
  private async submitLoginForm(
    loginOptions: LoginOptions,
    loginFrameOrPage: Page | Frame,
  ): Promise<void> {
    await waitForPageStability(this.page);
    LOG.info('login[3/5] fill %d fields', loginOptions.fields.length);
    await this.fillInputs(loginFrameOrPage, loginOptions.fields);
    const submitCtx = this.activeLoginContext ?? loginFrameOrPage;
    if (typeof loginOptions.submitButtonSelector === 'string') {
      await clickButton(submitCtx, loginOptions.submitButtonSelector);
    } else {
      await loginOptions.submitButtonSelector();
    }
    this.emitProgress(ScraperProgressTypes.LoggingIn);
  }

  /**
   * Handles the post-submit OTP step and waits for post-login navigation.
   *
   * @param loginOptions - login configuration with result conditions and postAction
   * @returns an early login result if OTP or URL already resolved, or null to continue
   */
  private async checkOtpAndNavigate(
    loginOptions: LoginOptions,
  ): Promise<ScraperScrapingResult | null> {
    await sleep(1500);
    const submitPageUrl = this.page.url();
    LOG.info('login[4/5] submit url-after=%s', submitPageUrl);
    const otpResult = await handleOtpStep(this.page, this.options);
    if (otpResult !== null) return otpResult;
    try {
      const currentPageUrl = this.page.url(); // may throw if page is closed
      const r = await getKeyByValue(loginOptions.possibleResults, currentPageUrl, this.page);
      if (r !== LOGIN_RESULTS.UnknownError) return this.handleLoginResult(r);
    } catch {
      /* fall through to postAction */
    }
    await (loginOptions.postAction ? loginOptions.postAction() : waitForNavigation(this.page));
    return null;
  }

  /**
   * Builds an error result for a failed login attempt.
   *
   * @param loginResult - the specific failure type (InvalidPassword or UnknownError)
   * @returns a failed ScraperScrapingResult with the appropriate error type
   */
  private handleFailedLogin(loginResult: LoginResults): ScraperScrapingResult {
    this.emitProgress(ScraperProgressTypes.LoginFailed);
    const errorType =
      loginResult === LOGIN_RESULTS.InvalidPassword
        ? ScraperErrorTypes.InvalidPassword
        : ScraperErrorTypes.Generic;
    return {
      success: false,
      errorType,
      errorMessage: `Login failed with ${loginResult} error — url: ${this.page.url()}`,
    };
  }

  /**
   * Converts the matched LoginResults key into a final ScraperScrapingResult.
   *
   * @param loginResult - the matched login result key
   * @returns the corresponding ScraperScrapingResult
   */
  private handleLoginResult(loginResult: LoginResults): ScraperScrapingResult {
    this.diagState.lastAction = `login result: ${loginResult}`;
    LOG.info('login[5/5] result=%s url=%s', loginResult, this.diagState.finalUrl ?? '?');
    LOG.info('login[5/5] title=%s', this.diagState.pageTitle ?? '');
    if (loginResult === LOGIN_RESULTS.Success) {
      this.emitProgress(ScraperProgressTypes.LoginSuccess);
      return { success: true };
    }
    if (loginResult === LOGIN_RESULTS.ChangePassword) {
      this.emitProgress(ScraperProgressTypes.ChangePassword);
      return { success: false, errorType: ScraperErrorTypes.ChangePassword };
    }
    if (loginResult === LOGIN_RESULTS.InvalidPassword || loginResult === LOGIN_RESULTS.UnknownError)
      return this.handleFailedLogin(loginResult);
    const loginError = `unexpected login result "${loginResult}"`;
    throw new ScraperWebsiteChangedError('BaseScraperWithBrowser', loginError);
  }
}

export { BaseScraperWithBrowser };
