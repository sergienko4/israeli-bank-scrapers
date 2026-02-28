import { chromium, type Browser, type Frame, type Page } from 'playwright';
import { ScraperProgressTypes } from '../definitions';
import { getDebug } from '../helpers/debug';
import { buildContextOptions } from '../helpers/browser';
import { clickButton, fillInput, waitUntilElementFound } from '../helpers/elements-interactions';
import { getCurrentUrl, waitForNavigation, type WaitUntilState } from '../helpers/navigation';
import { extractCredentialKey, resolveFieldContext } from '../helpers/selector-resolver';
import { type FieldConfig } from './login-config';
import { sleep } from '../helpers/waiting';
import { BaseScraper } from './base-scraper';
import { ScraperErrorTypes } from './errors';
import { type ScraperCredentials, type ScraperScrapingResult } from './interface';
import { handleOtpStep } from '../helpers/otp-handler';

const debug = getDebug('base-scraper-with-browser');

enum LoginBaseResults {
  Success = 'SUCCESS',
  UnknownError = 'UNKNOWN_ERROR',
}

const { Timeout: _Timeout, Generic: _Generic, General: _General, WafBlocked: _WafBlocked, ...rest } = ScraperErrorTypes;
export const LoginResults = {
  ...rest,
  ...LoginBaseResults,
};

export type LoginResults =
  | Exclude<
      ScraperErrorTypes,
      ScraperErrorTypes.Timeout | ScraperErrorTypes.Generic | ScraperErrorTypes.General | ScraperErrorTypes.WafBlocked
    >
  | LoginBaseResults;

export type PossibleLoginResults = {
  [key in LoginResults]?: (string | RegExp | ((options?: { page?: Page }) => Promise<boolean>))[];
};

export interface LoginOptions {
  loginUrl: string;
  checkReadiness?: () => Promise<void>;
  fields: { selector: string; value: string; credentialKey?: string }[];
  submitButtonSelector: string | (() => Promise<void>);
  preAction?: () => Promise<Frame | void>;
  postAction?: () => Promise<void>;
  possibleResults: PossibleLoginResults;
  waitUntil?: WaitUntilState;
}

type LoginCondition = string | RegExp | ((options?: { page?: Page }) => Promise<boolean>);

async function getKeyByValue(object: PossibleLoginResults, value: string, page: Page): Promise<LoginResults> {
  const keys = Object.keys(object) as LoginResults[];
  for (const key of keys) {
    const conditions = object[key] as LoginCondition[];

    for (const condition of conditions) {
      let result = false;

      if (condition instanceof RegExp) {
        result = condition.test(value);
      } else if (typeof condition === 'function') {
        result = await condition({ page });
      } else {
        result = value.toLowerCase() === condition.toLowerCase();
      }

      if (result) {
        return Promise.resolve(key);
      }
    }
  }

  return Promise.resolve(LoginResults.UnknownError);
}

async function alreadyAtResultUrl(possibleResults: PossibleLoginResults, page: Page): Promise<boolean> {
  try {
    const result = await getKeyByValue(possibleResults, page.url(), page);
    return result !== LoginResults.UnknownError;
  } catch {
    return false;
  }
}

function createGeneralError(): ScraperScrapingResult {
  return { success: false, errorType: ScraperErrorTypes.General };
}

async function safeCleanup(cleanup: () => Promise<void>): Promise<void> {
  try {
    await cleanup();
  } catch (e) {
    debug(`Cleanup function failed: ${(e as Error).message}`);
  }
}

class BaseScraperWithBrowser<TCredentials extends ScraperCredentials> extends BaseScraper<TCredentials> {
  private cleanups: Array<() => Promise<void>> = [];

  protected activeLoginContext: Page | Frame | null = null;

  protected page!: Page;

  protected getViewPort(): { width: number; height: number } | undefined {
    return this.options.viewportSize;
  }

  private async setupPage(page: Page): Promise<void> {
    this.page = page;
    this.cleanups.push(() => page.close());
    if (this.options.defaultTimeout) this.page.setDefaultTimeout(this.options.defaultTimeout);
    if (this.options.preparePage) {
      debug("execute 'preparePage' interceptor provided in options");
      await this.options.preparePage(this.page);
    }
    this.page.on('requestfailed', request => {
      debug('Request failed: %s %s', request.failure()?.errorText, request.url());
    });
  }

  async initialize(): Promise<void> {
    await super.initialize();
    debug('initialize scraper');
    this.emitProgress(ScraperProgressTypes.Initializing);
    const page = await this.initializePage();
    if (!page) {
      debug('failed to initiate a browser page, exit');
      return;
    }
    await this.setupPage(page);
  }

  private async createContextAndPage(browser: Browser, registerContextCleanup = true): Promise<Page> {
    const context = await browser.newContext(buildContextOptions(this.getViewPort()));
    if (registerContextCleanup) this.cleanups.push(async () => context.close());
    return context.newPage();
  }

  private rejectCustomExecutablePath(): void {
    if ('executablePath' in this.options && this.options.executablePath) {
      throw new Error(
        `Custom executablePath "${this.options.executablePath}" is not supported.\n\n` +
          'PROBLEM: System Chromium (from apt-get) is incompatible with Playwright.\n' +
          'FIX: npx playwright install chromium --with-deps',
      );
    }
  }

  private registerBrowserCleanup(browser: Browser): void {
    this.cleanups.push(async () => {
      debug('closing the browser');
      await browser.close();
    });
  }

  private async initializePage(): Promise<Page | undefined> {
    debug('initialize browser page');
    if ('browserContext' in this.options) {
      debug('Using the browser context provided in options');
      return this.options.browserContext.newPage();
    }
    if ('browser' in this.options) {
      debug('Using the browser instance provided in options');
      const { browser } = this.options;
      if (!this.options.skipCloseBrowser) this.registerBrowserCleanup(browser);
      return this.createContextAndPage(browser);
    }
    const { timeout, args = [], executablePath, showBrowser } = this.options;
    debug(`launch a browser with headless mode = ${!showBrowser}`);
    this.rejectCustomExecutablePath();
    const browser = await chromium.launch({ headless: !showBrowser, executablePath, args, timeout });
    this.registerBrowserCleanup(browser);
    if (this.options.prepareBrowser) await this.options.prepareBrowser(browser);
    return this.createContextAndPage(browser, false);
  }

  async navigateTo(
    url: string,
    waitUntil: WaitUntilState | undefined = 'load',
    retries = this.options.navigationRetryCount ?? 0,
  ): Promise<void> {
    const response = await this.page?.goto(url, { waitUntil });
    if (response === null) return;
    if (!response) throw new Error(`Error while trying to navigate to url ${url}, response is undefined`);
    if (response.ok()) return;

    const status = response.status();
    if (status === 403) return this.retryOn403(url, waitUntil);
    if (retries > 0) {
      debug(`Failed to navigate to url ${url}, status code: ${status}, retrying ${retries} more times`);
      return this.navigateTo(url, waitUntil, retries - 1);
    }
    throw new Error(`Failed to navigate to url ${url}, status code: ${status}`);
  }

  private async retryOn403(url: string, waitUntil: WaitUntilState | undefined, attempt = 0): Promise<void> {
    const MAX_RETRIES = 2;
    const DELAY_MS = 15_000;
    if (attempt >= MAX_RETRIES)
      throw new Error(`Failed to navigate to url ${url}, status code: 403 (after ${MAX_RETRIES} retries)`);
    debug('WAF 403 on %s, waiting %ds before retry %d/%d', url, DELAY_MS / 1000, attempt + 1, MAX_RETRIES);
    await sleep(DELAY_MS);
    const currentStatus = (await this.page.goto(url, { waitUntil }))?.status() ?? 0;
    if (currentStatus === 200 || (currentStatus >= 300 && currentStatus < 400)) {
      debug('WAF 403 resolved after retry %d', attempt + 1);
      return;
    }
    return this.retryOn403(url, waitUntil, attempt + 1);
  }

  getLoginOptions(_credentials: ScraperCredentials): LoginOptions {
    throw new Error(`getLoginOptions() is not created in ${this.options.companyId}`);
  }

  async fillInputs(
    pageOrFrame: Page | Frame,
    fields: { selector: string; value: string; credentialKey?: string }[],
  ): Promise<void> {
    for (const field of fields) {
      const key = field.credentialKey ?? extractCredentialKey(field.selector);
      const fc: FieldConfig = { credentialKey: key, selectors: [{ kind: 'css', value: field.selector }] };
      try {
        const { selector, context } = await resolveFieldContext(
          this.activeLoginContext ?? pageOrFrame,
          fc,
          this.page.url(),
        );
        this.activeLoginContext = context;
        await fillInput(context, selector, field.value);
      } catch {
        await fillInput(this.activeLoginContext ?? pageOrFrame, field.selector, field.value);
      }
    }
  }

  private async prepareLoginPage(loginOptions: LoginOptions): Promise<void> {
    await this.navigateTo(loginOptions.loginUrl, loginOptions.waitUntil);
    if (loginOptions.checkReadiness) {
      debug("execute 'checkReadiness' interceptor provided in login options");
      await loginOptions.checkReadiness();
    } else if (typeof loginOptions.submitButtonSelector === 'string') {
      debug('wait until submit button is available');
      await waitUntilElementFound(this.page, loginOptions.submitButtonSelector);
    }
  }

  private async submitLoginForm(loginOptions: LoginOptions, loginFrameOrPage: Page | Frame): Promise<void> {
    debug('fill login components input with relevant values');
    await this.fillInputs(loginFrameOrPage, loginOptions.fields);
    debug('click on login submit button');
    const submitCtx = this.activeLoginContext ?? loginFrameOrPage;
    if (typeof loginOptions.submitButtonSelector === 'string') {
      await clickButton(submitCtx, loginOptions.submitButtonSelector);
    } else {
      await loginOptions.submitButtonSelector();
    }
    this.emitProgress(ScraperProgressTypes.LoggingIn);
  }

  private async checkOtpAndNavigate(loginOptions: LoginOptions): Promise<ScraperScrapingResult | null> {
    await sleep(1500);
    const otpResult = await handleOtpStep(this.page, this.options);
    if (otpResult !== null) return otpResult;
    if (loginOptions.postAction) {
      debug("execute 'postAction' interceptor provided in login options");
      await loginOptions.postAction();
    } else if (!(await alreadyAtResultUrl(loginOptions.possibleResults, this.page))) {
      await waitForNavigation(this.page);
    }
    return null;
  }

  async login(credentials: ScraperCredentials): Promise<ScraperScrapingResult> {
    if (!credentials || !this.page) return createGeneralError();
    this.activeLoginContext = null;
    const loginOptions = this.getLoginOptions(credentials);
    await this.prepareLoginPage(loginOptions);
    let loginFrameOrPage: Page | Frame | null = this.page;
    if (loginOptions.preAction) loginFrameOrPage = (await loginOptions.preAction()) || this.page;
    await this.submitLoginForm(loginOptions, loginFrameOrPage);
    const earlyResult = await this.checkOtpAndNavigate(loginOptions);
    if (earlyResult !== null) return earlyResult;
    const current = await getCurrentUrl(this.page, true);
    const loginResult = await getKeyByValue(loginOptions.possibleResults, current, this.page);
    debug(`handle login results ${loginResult}`);
    return this.handleLoginResult(loginResult);
  }

  async terminate(_success: boolean): Promise<void> {
    debug(`terminating browser with success = ${_success}`);
    this.emitProgress(ScraperProgressTypes.Terminating);
    if (!_success && !!this.options.storeFailureScreenShotPath) {
      debug(`create a snapshot before terminated in ${this.options.storeFailureScreenShotPath}`);
      await this.page.screenshot({ path: this.options.storeFailureScreenShotPath, fullPage: true }).catch(e => {
        debug('screenshot failed (page may be closed): %s', (e as Error).message?.slice(0, 80));
      });
    }
    await Promise.all(this.cleanups.reverse().map(safeCleanup));
    this.cleanups = [];
  }

  private handleLoginResult(loginResult: LoginResults): ScraperScrapingResult {
    if (loginResult === LoginResults.Success) {
      this.emitProgress(ScraperProgressTypes.LoginSuccess);
      return { success: true };
    }
    if (loginResult === LoginResults.ChangePassword) {
      this.emitProgress(ScraperProgressTypes.ChangePassword);
      return { success: false, errorType: ScraperErrorTypes.ChangePassword };
    }
    if (loginResult === LoginResults.InvalidPassword || loginResult === LoginResults.UnknownError) {
      this.emitProgress(ScraperProgressTypes.LoginFailed);
      const errorType =
        loginResult === LoginResults.InvalidPassword ? ScraperErrorTypes.InvalidPassword : ScraperErrorTypes.General;
      return { success: false, errorType, errorMessage: `Login failed with ${loginResult} error` };
    }
    throw new Error(`unexpected login result "${loginResult}"`);
  }
}

export { BaseScraperWithBrowser };
