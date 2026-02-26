import { chromium, type Browser, type Frame, type Page } from 'playwright';
import { ScraperProgressTypes } from '../definitions';
import { getDebug } from '../helpers/debug';
import { buildContextOptions } from '../helpers/browser';
import { clickButton, fillInput, waitUntilElementFound } from '../helpers/elements-interactions';
import { getCurrentUrl, waitForNavigation, type WaitUntilState } from '../helpers/navigation';
import { sleep } from '../helpers/waiting';
import { BaseScraper } from './base-scraper';
import { ScraperErrorTypes } from './errors';
import { type ScraperCredentials, type ScraperScrapingResult } from './interface';

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
  fields: { selector: string; value: string }[];
  submitButtonSelector: string | (() => Promise<void>);
  preAction?: () => Promise<Frame | void>;
  postAction?: () => Promise<void>;
  possibleResults: PossibleLoginResults;
  waitUntil?: WaitUntilState;
}

async function getKeyByValue(object: PossibleLoginResults, value: string, page: Page): Promise<LoginResults> {
  const keys = Object.keys(object);
  for (const key of keys) {
    // @ts-ignore
    const conditions = object[key];

    for (const condition of conditions) {
      let result = false;

      if (condition instanceof RegExp) {
        result = condition.test(value);
      } else if (typeof condition === 'function') {
        result = await condition({ page, value });
      } else {
        result = value.toLowerCase() === condition.toLowerCase();
      }

      if (result) {
        // @ts-ignore
        return Promise.resolve(key);
      }
    }
  }

  return Promise.resolve(LoginResults.UnknownError);
}

function createGeneralError(): ScraperScrapingResult {
  return {
    success: false,
    errorType: ScraperErrorTypes.General,
  };
}

async function safeCleanup(cleanup: () => Promise<void>) {
  try {
    await cleanup();
  } catch (e) {
    debug(`Cleanup function failed: ${(e as Error).message}`);
  }
}

class BaseScraperWithBrowser<TCredentials extends ScraperCredentials> extends BaseScraper<TCredentials> {
  private cleanups: Array<() => Promise<void>> = [];

  // NOTICE - it is discouraged to use bang (!) in general. It is used here because
  // all the classes that inherit from this base assume is it mandatory.
  protected page!: Page;

  protected getViewPort() {
    return this.options.viewportSize;
  }

  async initialize() {
    await super.initialize();
    debug('initialize scraper');
    this.emitProgress(ScraperProgressTypes.Initializing);

    const page = await this.initializePage();

    if (!page) {
      debug('failed to initiate a browser page, exit');
      return;
    }

    this.page = page;

    this.cleanups.push(() => page.close());

    if (this.options.defaultTimeout) {
      this.page.setDefaultTimeout(this.options.defaultTimeout);
    }

    if (this.options.preparePage) {
      debug("execute 'preparePage' interceptor provided in options");
      await this.options.preparePage(this.page);
    }

    this.page.on('requestfailed', request => {
      debug('Request failed: %s %s', request.failure()?.errorText, request.url());
    });
  }

  private async createContextAndPage(browser: Browser, registerContextCleanup = true): Promise<Page> {
    const context = await browser.newContext(buildContextOptions(this.getViewPort()));
    if (registerContextCleanup) {
      this.cleanups.push(async () => context.close());
    }
    return context.newPage();
  }

  private rejectCustomExecutablePath() {
    if ('executablePath' in this.options && this.options.executablePath) {
      throw new Error(
        `Custom executablePath "${this.options.executablePath}" is not supported.\n\n` +
          'PROBLEM: System Chromium (from apt-get) is incompatible with Playwright.\n' +
          'It causes Cloudflare 403 blocks, session storage timeouts, and WAF detection.\n\n' +
          "FIX: Remove the executablePath option and install Playwright's bundled Chromium:\n" +
          '  npx playwright install chromium --with-deps\n\n' +
          'For Docker, add to your Dockerfile:\n' +
          '  ENV PLAYWRIGHT_BROWSERS_PATH=/app/browsers\n' +
          '  RUN npx playwright install chromium --with-deps',
      );
    }
  }

  private registerBrowserCleanup(browser: Browser) {
    this.cleanups.push(async () => {
      debug('closing the browser');
      await browser.close();
    });
  }

  private async initializePage() {
    debug('initialize browser page');
    if ('browserContext' in this.options) {
      debug('Using the browser context provided in options');
      return this.options.browserContext.newPage();
    }

    if ('browser' in this.options) {
      debug('Using the browser instance provided in options');
      const { browser } = this.options;
      if (!this.options.skipCloseBrowser) {
        this.registerBrowserCleanup(browser);
      }
      return this.createContextAndPage(browser);
    }

    const { timeout, args = [], executablePath, showBrowser } = this.options;
    const headless = !showBrowser;
    debug(`launch a browser with headless mode = ${headless}`);

    this.rejectCustomExecutablePath();
    const browser = await chromium.launch({ headless, executablePath, args, timeout });
    this.registerBrowserCleanup(browser);

    if (this.options.prepareBrowser) {
      debug("execute 'prepareBrowser' interceptor provided in options");
      await this.options.prepareBrowser(browser);
    }

    // Skip context cleanup — browser.close() disposes all contexts
    return this.createContextAndPage(browser, false);
  }

  async navigateTo(
    url: string,
    waitUntil: WaitUntilState | undefined = 'load',
    retries = this.options.navigationRetryCount ?? 0,
  ): Promise<void> {
    const response = await this.page?.goto(url, { waitUntil });
    // response is null when navigating to same url while changing the hash part
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

    if (attempt >= MAX_RETRIES) {
      throw new Error(`Failed to navigate to url ${url}, status code: 403 (after ${MAX_RETRIES} retries)`);
    }

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

  async fillInputs(pageOrFrame: Page | Frame, fields: { selector: string; value: string }[]): Promise<void> {
    const modified = [...fields];
    const input = modified.shift();

    if (!input) {
      return;
    }
    await fillInput(pageOrFrame, input.selector, input.value);
    if (modified.length) {
      await this.fillInputs(pageOrFrame, modified);
    }
  }

  async login(credentials: ScraperCredentials): Promise<ScraperScrapingResult> {
    if (!credentials || !this.page) {
      return createGeneralError();
    }

    debug('execute login process');
    const loginOptions = this.getLoginOptions(credentials);

    debug('navigate to login url');
    await this.navigateTo(loginOptions.loginUrl, loginOptions.waitUntil);
    if (loginOptions.checkReadiness) {
      debug("execute 'checkReadiness' interceptor provided in login options");
      await loginOptions.checkReadiness();
    } else if (typeof loginOptions.submitButtonSelector === 'string') {
      debug('wait until submit button is available');
      await waitUntilElementFound(this.page, loginOptions.submitButtonSelector);
    }

    let loginFrameOrPage: Page | Frame | null = this.page;
    if (loginOptions.preAction) {
      debug("execute 'preAction' interceptor provided in login options");
      loginFrameOrPage = (await loginOptions.preAction()) || this.page;
    }

    debug('fill login components input with relevant values');
    await this.fillInputs(loginFrameOrPage, loginOptions.fields);
    debug('click on login submit button');
    if (typeof loginOptions.submitButtonSelector === 'string') {
      await clickButton(loginFrameOrPage, loginOptions.submitButtonSelector);
    } else {
      await loginOptions.submitButtonSelector();
    }
    this.emitProgress(ScraperProgressTypes.LoggingIn);

    if (loginOptions.postAction) {
      debug("execute 'postAction' interceptor provided in login options");
      await loginOptions.postAction();
    } else {
      debug('wait for page navigation');
      await waitForNavigation(this.page);
    }

    debug('check login result');
    const current = await getCurrentUrl(this.page, true);
    const loginResult = await getKeyByValue(loginOptions.possibleResults, current, this.page);
    debug(`handle login results ${loginResult}`);
    return this.handleLoginResult(loginResult);
  }

  async terminate(_success: boolean) {
    debug(`terminating browser with success = ${_success}`);
    this.emitProgress(ScraperProgressTypes.Terminating);

    if (!_success && !!this.options.storeFailureScreenShotPath) {
      debug(`create a snapshot before terminated in ${this.options.storeFailureScreenShotPath}`);
      await this.page.screenshot({
        path: this.options.storeFailureScreenShotPath,
        fullPage: true,
      });
    }

    await Promise.all(this.cleanups.reverse().map(safeCleanup));
    this.cleanups = [];
  }

  private handleLoginResult(loginResult: LoginResults) {
    switch (loginResult) {
      case LoginResults.Success:
        this.emitProgress(ScraperProgressTypes.LoginSuccess);
        return { success: true };
      case LoginResults.InvalidPassword:
      case LoginResults.UnknownError:
        this.emitProgress(ScraperProgressTypes.LoginFailed);
        return {
          success: false,
          errorType:
            loginResult === LoginResults.InvalidPassword
              ? ScraperErrorTypes.InvalidPassword
              : ScraperErrorTypes.General,
          errorMessage: `Login failed with ${loginResult} error`,
        };
      case LoginResults.ChangePassword:
        this.emitProgress(ScraperProgressTypes.ChangePassword);
        return {
          success: false,
          errorType: ScraperErrorTypes.ChangePassword,
        };
      default:
        throw new Error(`unexpected login result "${loginResult}"`);
    }
  }
}

export { BaseScraperWithBrowser };
