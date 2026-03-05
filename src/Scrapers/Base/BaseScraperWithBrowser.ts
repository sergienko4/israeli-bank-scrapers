import type { Browser, Frame, Page } from 'playwright';
import { chromium } from 'playwright-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';

chromium.use(StealthPlugin());

import { buildContextOptions } from '../../Common/Browser';
import { getDebug } from '../../Common/Debug';
import { clickButton, fillInput, waitUntilElementFound } from '../../Common/ElementsInteractions';
import { getCurrentUrl, waitForNavigation, type WaitUntilState } from '../../Common/Navigation';
import { handleOtpStep } from '../../Common/OtpHandler';
import { extractCredentialKey, resolveFieldContext } from '../../Common/SelectorResolver';
import { sleep } from '../../Common/Waiting';
import { ScraperProgressTypes } from '../../Definitions';
import { BaseScraper } from './BaseScraper';
import {
  detectGenericInvalidPassword,
  getKeyByValue,
  LOGIN_RESULTS,
  type LoginOptions,
  type LoginResults,
  type PossibleLoginResults,
  safeCleanup,
} from './BaseScraperHelpers';
import { ScraperErrorTypes } from './Errors';
import type { DefaultBrowserOptions, ScraperCredentials, ScraperScrapingResult } from './Interface';
import type { FieldConfig } from './LoginConfig';
import { ScraperWebsiteChangedError } from './ScraperWebsiteChangedError';

export { LOGIN_RESULTS, type LoginOptions, type LoginResults, type PossibleLoginResults };

const LOG = getDebug('base-scraper-with-browser');

function buildFieldConfig(field: { selector: string; credentialKey?: string }): FieldConfig {
  const key = field.credentialKey ?? extractCredentialKey(field.selector);
  return { credentialKey: key, selectors: [{ kind: 'css', value: field.selector }] };
}

class BaseScraperWithBrowser<
  TCredentials extends ScraperCredentials,
> extends BaseScraper<TCredentials> {
  private static readonly _max403Retries = 2;

  protected activeLoginContext: Page | Frame | null = null;

  protected page!: Page;

  private _cleanups: (() => Promise<void>)[] = [];

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
    if (status === 403) return this.retryOn403(url, waitUntil);
    if (retries > 0) {
      LOG.info('navigateTo %s → %d, retrying (%d left)', url, status, retries);
      return this.navigateTo(url, waitUntil, retries - 1);
    }
    const navError = `Failed to navigate: ${url} (${String(status)})`;
    throw new ScraperWebsiteChangedError('BaseScraperWithBrowser', navError);
  }

  public getLoginOptions(credentials: ScraperCredentials): LoginOptions {
    void credentials;
    throw new ScraperWebsiteChangedError(
      this.options.companyId,
      'getLoginOptions() not implemented',
    );
  }

  public async fillInputs(
    pageOrFrame: Page | Frame,
    fields: { selector: string; value: string; credentialKey?: string }[],
  ): Promise<void> {
    await fields.reduce(async (prev, field) => {
      await prev;
      await this.fillOneInput(pageOrFrame, field);
    }, Promise.resolve());
  }

  public async login(credentials: ScraperCredentials): Promise<ScraperScrapingResult> {
    this.activeLoginContext = null;
    const loginOptions = this.getLoginOptions(credentials);
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

  public async terminate(_success: boolean): Promise<void> {
    LOG.info(`terminating browser with success = ${String(_success)}`);
    this.emitProgress(ScraperProgressTypes.Terminating);
    if (!_success && !!this.options.storeFailureScreenShotPath) {
      LOG.info('snapshot before terminate in %s', this.options.storeFailureScreenShotPath);
      await this.page
        .screenshot({ path: this.options.storeFailureScreenShotPath, fullPage: true })
        .catch((e: unknown) => {
          LOG.info('screenshot failed: %s', (e as Error).message.slice(0, 80));
        });
    }
    await Promise.all(this._cleanups.reverse().map(safeCleanup));
    this._cleanups = [];
  }

  private async fillOneInput(
    pageOrFrame: Page | Frame,
    field: { selector: string; value: string; credentialKey?: string },
  ): Promise<void> {
    const fc = buildFieldConfig(field);
    const result = await resolveFieldContext(
      this.activeLoginContext ?? pageOrFrame,
      fc,
      this.page.url(),
    );
    if (result.isResolved) {
      this.activeLoginContext = result.context;
      await fillInput(result.context, result.selector, field.value);
    } else {
      await fillInput(this.activeLoginContext ?? pageOrFrame, field.selector, field.value);
    }
  }

  private async setupPage(page: Page): Promise<void> {
    this.page = page;
    this._cleanups.push(() => page.close());
    if (this.options.defaultTimeout) this.page.setDefaultTimeout(this.options.defaultTimeout);
    if (this.options.preparePage) {
      LOG.info("execute 'preparePage' interceptor provided in options");
      await this.options.preparePage(this.page);
    }
    this.page.on('requestfailed', request => {
      LOG.info('Request failed: %s %s', request.failure()?.errorText, request.url());
    });
  }

  private async createContextAndPage(
    browser: Browser,
    registerContextCleanup = true,
  ): Promise<Page> {
    const context = await browser.newContext(buildContextOptions());
    if (registerContextCleanup) this._cleanups.push(async () => context.close());
    return context.newPage();
  }

  private rejectCustomExecutablePath(): void {
    if ('executablePath' in this.options && this.options.executablePath) {
      const msg =
        'Custom executablePath is not supported. Use: npx playwright install chromium --with-deps';
      throw new ScraperWebsiteChangedError('BaseScraperWithBrowser', msg);
    }
  }

  private registerBrowserCleanup(browser: Browser): void {
    this._cleanups.push(async () => {
      LOG.info('closing the browser');
      await browser.close();
    });
  }

  private async launchNewBrowser(): Promise<Page> {
    const opts = this.options as DefaultBrowserOptions;
    const { timeout, args = [], executablePath, shouldShowBrowser } = opts;
    LOG.info(`launch a browser with headless mode = ${String(!shouldShowBrowser)}`);
    this.rejectCustomExecutablePath();
    const browser = await chromium.launch({
      headless: !shouldShowBrowser,
      executablePath,
      args,
      timeout,
    });
    this.registerBrowserCleanup(browser);
    if (opts.prepareBrowser) await opts.prepareBrowser(browser);
    return this.createContextAndPage(browser, false);
  }

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

  private async navigateAfterDelay(
    url: string,
    waitUntil: WaitUntilState | undefined,
    attempt: number,
  ): Promise<number> {
    const delayMs = 15_000;
    const max = BaseScraperWithBrowser._max403Retries;
    LOG.info('WAF 403 on %s, retry %d/%d after %ds', url, attempt + 1, max, delayMs / 1000);
    await sleep(delayMs);
    return (await this.page.goto(url, { waitUntil }))?.status() ?? 0;
  }

  private async retryOn403(
    url: string,
    waitUntil: WaitUntilState | undefined,
    attempt = 0,
  ): Promise<void> {
    const maxRetries = BaseScraperWithBrowser._max403Retries;
    if (attempt >= maxRetries)
      throw new ScraperWebsiteChangedError(
        'BaseScraperWithBrowser',
        `Failed: 403 on ${url} (after ${String(maxRetries)} retries)`,
      );
    const currentStatus = await this.navigateAfterDelay(url, waitUntil, attempt);
    if (currentStatus === 200 || (currentStatus >= 300 && currentStatus < 400)) {
      LOG.info('WAF 403 resolved after retry %d', attempt + 1);
      return;
    }
    return this.retryOn403(url, waitUntil, attempt + 1);
  }

  private async prepareLoginPage(loginOptions: LoginOptions): Promise<void> {
    this.diagState.loginUrl = loginOptions.loginUrl;
    await this.navigateTo(loginOptions.loginUrl, loginOptions.waitUntil);
    if (loginOptions.checkReadiness) {
      await loginOptions.checkReadiness();
    } else if (typeof loginOptions.submitButtonSelector === 'string') {
      await waitUntilElementFound(this.page, loginOptions.submitButtonSelector);
    }
    LOG.info('login[2/5] checkReadiness passed url=%s', this.page.url());
  }

  private async submitLoginForm(
    loginOptions: LoginOptions,
    loginFrameOrPage: Page | Frame,
  ): Promise<void> {
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

  private async checkOtpAndNavigate(
    loginOptions: LoginOptions,
  ): Promise<ScraperScrapingResult | null> {
    await sleep(1500);
    LOG.info('login[4/5] submit url-after=%s', this.page.url());
    const otpResult = await handleOtpStep(this.page, this.options);
    if (otpResult !== null) return otpResult;
    // Skip postAction if submit already landed on a known result (avoids waitForRedirect TIMEOUT).
    try {
      const r = await getKeyByValue(loginOptions.possibleResults, this.page.url(), this.page);
      if (r !== LOGIN_RESULTS.UnknownError) return this.handleLoginResult(r);
    } catch {
      // page.url() may throw when page is closed — fall through to postAction
    }
    if (loginOptions.postAction) {
      await loginOptions.postAction();
    } else {
      await waitForNavigation(this.page);
    }
    return null;
  }

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
