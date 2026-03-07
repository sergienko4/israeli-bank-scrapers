import type { Browser, Frame, Page } from 'playwright';

import { buildContextOptions } from '../../Common/Browser';
import { BrowserEngineType, launchWithEngine } from '../../Common/BrowserEngine';
import { getDebug } from '../../Common/Debug';
import { clickButton, fillInput, waitUntilElementFound } from '../../Common/ElementsInteractions';
import { getCurrentUrl, waitForNavigation, type WaitUntilState } from '../../Common/Navigation';
import { handleOtpStep } from '../../Common/OtpHandler';
import waitForPageStability from '../../Common/PageStability';
import { resolveFieldContext } from '../../Common/SelectorResolver';
import { sleep } from '../../Common/Waiting';
import { ScraperProgressTypes } from '../../Definitions';
import type { FoundResult } from '../../Interfaces/Common/FoundResult';
import type { LoginStepResult } from '../../Interfaces/Common/LoginStepResult';
import type { IDoneResult } from '../../Interfaces/Common/StepResult';
import { getWrongCredentialTexts } from '../Registry/ScraperConfig';
import { BaseScraper } from './BaseScraper';
import {
  buildFieldConfig,
  buildHeadlessArgs,
  detectGenericInvalidPassword,
  detectWafRedirect,
  getKeyByValue,
  type ILoginOptions,
  isStuckOnLoginPage,
  LOGIN_RESULTS,
  type LoginResults,
  type PossibleLoginResults,
  retryOn403,
  safeCleanup,
} from './BaseScraperHelpers';
import { ScraperErrorTypes } from './Errors';
import type {
  IDefaultBrowserOptions,
  IScraperScrapingResult,
  ScraperCredentials,
} from './Interface';
import { ScraperWebsiteChangedError } from './ScraperWebsiteChangedError';

export { type ILoginOptions, LOGIN_RESULTS, type LoginResults, type PossibleLoginResults };

const LOG = getDebug('base-scraper-with-browser');
const EXEC_PATH_NOT_SUPPORTED = 'executablePath not supported — install: npx playwright install';

/**
 * Base scraper that drives a Playwright browser for bank login and navigation.
 * Extend this class (or GenericBankScraper) for each bank scraper implementation.
 */
class BaseScraperWithBrowser<
  TCredentials extends ScraperCredentials,
> extends BaseScraper<TCredentials> {
  protected activeLoginContext: Page | Frame | null = null;

  protected page!: Page;

  private _cleanups: (() => Promise<IDoneResult>)[] = [];

  /**
   * Initializes the scraper by launching a browser and creating a page.
   *
   * @returns a promise that resolves when the browser page is ready
   */
  public async initialize(): Promise<IDoneResult> {
    await super.initialize();
    this.emitProgress(ScraperProgressTypes.Initializing);
    const page = await this.initializePage();
    await this.setupPage(page);
    return { done: true };
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
  ): Promise<IDoneResult> {
    const startMs = Date.now();
    const response = await this.page.goto(url, { waitUntil });
    if (response === null) return { done: true };
    const status = response.status();
    LOG.info('navigateTo %s → %d (%dms)', url, status, Date.now() - startMs);
    if (response.ok()) return { done: true };
    if (status === 403) return retryOn403({ page: this.page, url, waitUntil });
    if (retries > 0) return this.navigateTo(url, waitUntil, retries - 1);
    const navError = `Failed to navigate: ${url} (${String(status)})`;
    throw new ScraperWebsiteChangedError('BaseScraperWithBrowser', navError);
  }

  /**
   * Returns the login configuration for this scraper. Override in each bank subclass.
   *
   * @param credentials - bank login credentials to embed in the login options
   * @returns the login options describing URL, fields, and result conditions
   */
  public getLoginOptions(credentials: ScraperCredentials): ILoginOptions {
    void credentials;
    throw new ScraperWebsiteChangedError(
      this.options.companyId,
      'getLoginOptions() not implemented',
    );
  }

  /**
   * Fills multiple form inputs sequentially, using SelectorResolver for each field.
   *
   * @param pageOrFrame - the page or iframe containing the input fields
   * @param fields - field descriptors with CSS selector and value to type
   * @returns a promise that resolves when all fields are filled
   */
  public async fillInputs(
    pageOrFrame: Page | Frame,
    fields: { selector: string; value: string; credentialKey?: string }[],
  ): Promise<IDoneResult> {
    const initialPromise = Promise.resolve({ done: true } as IDoneResult);
    await fields.reduce(async (prev, field) => {
      await prev;
      return this.fillOneInput(pageOrFrame, field);
    }, initialPromise);
    return { done: true };
  }

  /**
   * Performs the browser-based login, retrying once if stuck on the login page.
   *
   * @param credentials - bank login credentials
   * @returns the login result or an error result on failure
   */
  public async login(credentials: ScraperCredentials): Promise<IScraperScrapingResult> {
    const loginOptions = this.getLoginOptions(credentials);
    try {
      return await this.attemptLogin(loginOptions);
    } catch (err) {
      const currentPageUrl = this.safePageUrl();
      if (!isStuckOnLoginPage(currentPageUrl, loginOptions.loginUrl)) throw err;
      LOG.info('login: stuck on login URL — retrying once');
      this.activeLoginContext = null;
      return this.attemptLogin(loginOptions);
    }
  }

  /**
   * Closes all browser contexts and pages, optionally saving a failure screenshot.
   *
   * @param success - whether the scraping completed successfully
   * @returns a promise that resolves when all cleanups are complete
   */
  public async terminate(success: boolean): Promise<IDoneResult> {
    LOG.info(`terminating browser with success = ${String(success)}`);
    this.emitProgress(ScraperProgressTypes.Terminating);
    if (!success && this.options.storeFailureScreenShotPath) {
      await this.page
        .screenshot({ path: this.options.storeFailureScreenShotPath, fullPage: true })
        .catch((e: unknown) => {
          const msg = (e as Error).message;
          const snippet = msg.slice(0, 80);
          LOG.info('screenshot failed: %s', snippet);
        });
    }
    const cleanupTasks = this._cleanups.reverse().map(safeCleanup);
    await Promise.all(cleanupTasks);
    this._cleanups = [];
    return { done: true };
  }

  /**
   * Returns the current page URL without throwing if the page is closed.
   *
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
  private async attemptLogin(loginOptions: ILoginOptions): Promise<IScraperScrapingResult> {
    this.activeLoginContext = null;
    await this.prepareLoginPage(loginOptions);
    const loginFrameOrPage = await this.resolveLoginFrame(loginOptions);
    await this.submitLoginForm(loginOptions, loginFrameOrPage);
    const earlyStep = await this.checkOtpAndNavigate(loginOptions);
    if (!earlyStep.shouldContinue) return earlyStep.result;
    const current = await getCurrentUrl(this.page, true);
    this.diagState.finalUrl = current;
    this.diagState.pageTitle = await this.page.title().catch(() => '');
    const hasInvalidPassword = await detectGenericInvalidPassword(this.page);
    let loginResult = await getKeyByValue(loginOptions.possibleResults, current, this.page);
    if (loginResult === LOGIN_RESULTS.UnknownError && hasInvalidPassword)
      loginResult = LOGIN_RESULTS.InvalidPassword;
    return this.handleLoginResult(loginResult);
  }

  /**
   * Resolves whether to use an iframe or the main page for login form interactions.
   *
   * @param loginOptions - login configuration with optional preAction
   * @returns the page or frame to use for form filling
   */
  private async resolveLoginFrame(loginOptions: ILoginOptions): Promise<Page | Frame> {
    if (!loginOptions.preAction) return this.page;
    const preResult = await loginOptions.preAction();
    return preResult.isFound ? preResult.value : this.page;
  }

  /**
   * Fills a single input field using SelectorResolver with a CSS fallback.
   *
   * @param pageOrFrame - the page or iframe containing the input
   * @param field - field descriptor with selector, value, and optional credentialKey
   * @param field.selector - CSS selector for the input element
   * @param field.value - the text to type into the input
   * @param field.credentialKey - optional override for SelectorResolver credential key
   * @returns a promise that resolves when the field is filled
   */
  private async fillOneInput(
    pageOrFrame: Page | Frame,
    field: { selector: string; value: string; credentialKey?: string },
  ): Promise<IDoneResult> {
    const fc = buildFieldConfig(field);
    const currentPageUrl = this.page.url();
    const activeCtx = this.activeLoginContext ?? pageOrFrame;
    const result = await resolveFieldContext(activeCtx, fc, currentPageUrl);
    if (result.isResolved) {
      this.activeLoginContext = result.context;
      await fillInput(result.context, result.selector, field.value);
    } else {
      await fillInput(activeCtx, field.selector, field.value);
    }
    return { done: true };
  }

  /**
   * Configures the page with timeouts, preparePage hook, and request-failure logging.
   *
   * @param page - the newly created Playwright page to configure
   * @returns a promise that resolves when setup is complete
   */
  private async setupPage(page: Page): Promise<IDoneResult> {
    this.page = page;
    this._cleanups.push(() => page.close().then(() => ({ done: true as const })));
    if (this.options.defaultTimeout) this.page.setDefaultTimeout(this.options.defaultTimeout);
    if (this.options.preparePage) await this.options.preparePage(this.page);
    this.page.on('requestfailed', request => {
      const failureText = request.failure()?.errorText;
      const requestUrl = request.url();
      LOG.info('Request failed: %s %s', failureText, requestUrl);
    });
    return { done: true };
  }

  /**
   * Creates a new browser context with Hebrew locale settings and returns a fresh page.
   *
   * @param browser - the Playwright Browser instance to create the context in
   * @param registerContextCleanup - whether to register a cleanup to close the context
   * @returns a new Playwright Page in a fresh context
   */
  private async createContextAndPage(
    browser: Browser,
    registerContextCleanup = true,
  ): Promise<Page> {
    const contextOptions = buildContextOptions();
    const context = await browser.newContext(contextOptions);
    if (registerContextCleanup)
      this._cleanups.push(() => context.close().then(() => ({ done: true as const })));
    return context.newPage();
  }

  /**
   * Registers a cleanup function to close the browser when terminate() is called.
   *
   * @param browser - the Playwright Browser to close during cleanup
   */
  private registerBrowserCleanup(browser: Browser): void {
    this._cleanups.push(() => browser.close().then(() => ({ done: true as const })));
  }

  /**
   * Launches a new Chromium browser with configured headless/visible settings.
   *
   * @returns a new Playwright Page ready for use
   */
  private async launchNewBrowser(): Promise<Page> {
    const opts = this.options as IDefaultBrowserOptions;
    const { timeout, args = [], executablePath, shouldShowBrowser, engineType } = opts;
    const isHeadless = !shouldShowBrowser;
    if ('executablePath' in this.options && this.options.executablePath)
      throw new ScraperWebsiteChangedError('BaseScraperWithBrowser', EXEC_PATH_NOT_SUPPORTED);
    const resolvedEngine = engineType ?? BrowserEngineType.PlaywrightStealth;
    const headlessArgs = buildHeadlessArgs(isHeadless);
    const browser = await launchWithEngine(resolvedEngine, {
      headless: isHeadless,
      executablePath,
      args: [...headlessArgs, ...args],
      timeout,
    });
    this.registerBrowserCleanup(browser);
    if (opts.prepareBrowser) await opts.prepareBrowser(browser);
    return this.createContextAndPage(browser, false);
  }

  /**
   * Creates the initial browser page from a provided context, browser, or a new launch.
   *
   * @returns the initialized Playwright Page
   */
  private async initializePage(): Promise<Page> {
    LOG.info('initialize browser page');
    if ('browserContext' in this.options) return this.options.browserContext.newPage();
    if ('browser' in this.options) {
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
   * @returns a promise that resolves when the page is ready
   */
  private async prepareLoginPage(loginOptions: ILoginOptions): Promise<IDoneResult> {
    this.diagState.loginUrl = loginOptions.loginUrl;
    await this.navigateTo(loginOptions.loginUrl, loginOptions.waitUntil);
    if (loginOptions.checkReadiness) {
      await loginOptions.checkReadiness();
    } else if (typeof loginOptions.submitButtonSelector === 'string') {
      await waitUntilElementFound(this.page, loginOptions.submitButtonSelector);
    }
    const readinessUrl = this.page.url();
    LOG.info('login[2/5] checkReadiness passed url=%s', readinessUrl);
    return { done: true };
  }

  /**
   * Fills in the login form fields and clicks the submit button.
   *
   * @param loginOptions - login configuration with fields and submit button selector
   * @param loginFrameOrPage - the page or iframe containing the login form
   * @returns a promise that resolves when the form is submitted
   */
  private async submitLoginForm(
    loginOptions: ILoginOptions,
    loginFrameOrPage: Page | Frame,
  ): Promise<IDoneResult> {
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
    return { done: true };
  }

  /**
   * Checks if the current page URL already maps to a known login result.
   *
   * @param loginOptions - login configuration with result conditions
   * @returns FoundResult with login result if URL matched, or isFound: false to continue
   */
  private async checkCurrentUrlResult(
    loginOptions: ILoginOptions,
  ): Promise<FoundResult<IScraperScrapingResult>> {
    try {
      const currentPageUrl = this.page.url();
      const r = await getKeyByValue(loginOptions.possibleResults, currentPageUrl, this.page);
      if (r !== LOGIN_RESULTS.UnknownError) {
        return { isFound: true, value: this.handleLoginResult(r) };
      }
    } catch {
      /* fall through to postAction */
    }
    return { isFound: false };
  }

  /**
   * Handles the post-submit OTP step and waits for post-login navigation.
   * Includes early WAF-redirect and wrong-credentials detection.
   *
   * @param loginOptions - login configuration with result conditions and postAction
   * @returns LoginStepResult — shouldContinue: false when login resolved, true to continue
   */
  private async checkOtpAndNavigate(loginOptions: ILoginOptions): Promise<LoginStepResult> {
    await sleep(1500);
    const submitUrl = this.page.url();
    const wafStep = detectWafRedirect(submitUrl, this.options.companyId);
    if (!wafStep.shouldContinue) return wafStep;
    const wrongCredTexts = getWrongCredentialTexts(this.options.companyId);
    const isInvalid = await detectGenericInvalidPassword(this.page, wrongCredTexts);
    if (isInvalid) {
      const invalidResult = this.handleLoginResult(LOGIN_RESULTS.InvalidPassword);
      return { shouldContinue: false, result: invalidResult };
    }
    const otpResult = await handleOtpStep(this.page, this.options);
    if (otpResult.isFound) return { shouldContinue: false, result: otpResult.value };
    const urlCheckResult = await this.checkCurrentUrlResult(loginOptions);
    if (urlCheckResult.isFound) return { shouldContinue: false, result: urlCheckResult.value };
    await (loginOptions.postAction ? loginOptions.postAction() : waitForNavigation(this.page));
    return { shouldContinue: true };
  }

  /**
   * Builds an error result for a failed login attempt.
   *
   * @param loginResult - the specific failure type (InvalidPassword or UnknownError)
   * @returns a failed IScraperScrapingResult with the appropriate error type
   */
  private handleFailedLogin(loginResult: LoginResults): IScraperScrapingResult {
    this.emitProgress(ScraperProgressTypes.LoginFailed);
    const isInvalidPwd = loginResult === LOGIN_RESULTS.InvalidPassword;
    const errorType = isInvalidPwd ? ScraperErrorTypes.InvalidPassword : ScraperErrorTypes.Generic;
    const errorMessage = `Login failed: ${loginResult} — url: ${this.page.url()}`;
    return { success: false, errorType, errorMessage };
  }

  /**
   * Converts the matched LoginResults key into a final IScraperScrapingResult.
   *
   * @param loginResult - the matched login result key
   * @returns the corresponding IScraperScrapingResult
   */
  private handleLoginResult(loginResult: LoginResults): IScraperScrapingResult {
    this.diagState.lastAction = `login result: ${loginResult}`;
    LOG.info('login[5/5] result=%s url=%s', loginResult, this.diagState.finalUrl ?? '?');
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
    throw new ScraperWebsiteChangedError(
      'BaseScraperWithBrowser',
      `unexpected login result "${loginResult}"`,
    );
  }
}

export { BaseScraperWithBrowser };
