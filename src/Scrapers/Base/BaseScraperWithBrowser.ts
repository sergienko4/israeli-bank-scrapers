import type { Browser, Frame, Page } from 'playwright';

import { buildContextOptions } from '../../Common/Browser';
import { launchCamoufox } from '../../Common/CamoufoxLauncher';
import { getDebug } from '../../Common/Debug';
import { clickButton, fillInput, waitUntilElementFound } from '../../Common/ElementsInteractions';
import {
  CONTINUE,
  type LoginContext,
  type LoginStep,
  runLoginChain,
  type StepResult,
  stopWithResult,
} from '../../Common/LoginMiddleware';
import { getCurrentUrl, waitForNavigation, type WaitUntilState } from '../../Common/Navigation';
import { handleOtpCode, handleOtpConfirm } from '../../Common/OtpHandler';
import { extractCredentialKey, resolveFieldContext } from '../../Common/SelectorResolver';
import { sleep } from '../../Common/Waiting';
import { ScraperProgressTypes } from '../../Definitions';
import { SCRAPER_CONFIGURATION } from '../Registry/ScraperConfig';
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

export { LOGIN_RESULTS, type LoginOptions, type LoginResults, type PossibleLoginResults };

const LOG = getDebug('base-scraper-with-browser');

class BaseScraperWithBrowser<
  TCredentials extends ScraperCredentials,
> extends BaseScraper<TCredentials> {
  private static readonly MAX_403_RETRIES = 2;

  protected activeLoginContext: Page | Frame | null = null;

  protected page!: Page;

  private cleanups: (() => Promise<void>)[] = [];

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
    throw new Error(`Failed to navigate to url ${url}, status code: ${status}`);
  }

  public getLoginOptions(_credentials: ScraperCredentials): LoginOptions {
    throw new Error(`getLoginOptions() is not created in ${this.options.companyId}`);
  }

  public async fillInputs(
    pageOrFrame: Page | Frame,
    fields: { selector: string; value: string; credentialKey?: string }[],
  ): Promise<void> {
    for (const field of fields) {
      await this.fillOneInput(pageOrFrame, field);
    }
  }

  public async login(credentials: ScraperCredentials): Promise<ScraperScrapingResult> {
    this.activeLoginContext = null;
    const loginOptions = this.getLoginOptions(credentials);
    const { loginSetup } = SCRAPER_CONFIGURATION.banks[this.options.companyId];
    const ctx: LoginContext = { page: this.page, activeFrame: this.page, loginSetup };
    const steps = this.buildLoginChain(loginOptions, ctx);
    const chainResult = await runLoginChain(steps, ctx);
    if (chainResult !== null) return chainResult;
    return this.resolveLoginResult(loginOptions);
  }

  private buildLoginChain(loginOptions: LoginOptions, ctx: LoginContext): LoginStep[] {
    const steps: LoginStep[] = [];
    steps.push(() => this.stepNavigate(loginOptions));
    steps.push(() => this.stepFillAndSubmit(loginOptions, ctx));
    steps.push(() => this.stepWaitAfterSubmit());
    steps.push(() => this.stepCheckEarlyResult(loginOptions));
    if (ctx.loginSetup.hasOtpConfirm) {
      steps.push(() => this.stepOtpConfirm());
    }
    if (ctx.loginSetup.hasOtpCode) {
      steps.push(() => this.stepOtpCode());
    }
    if (ctx.loginSetup.hasSecondLoginStep) {
      steps.push(() => this.stepSecondLogin(loginOptions));
    }
    steps.push(() => this.stepPostAction(loginOptions));
    return steps;
  }

  public async terminate(_success: boolean): Promise<void> {
    LOG.info(`terminating browser with success = ${_success}`);
    this.emitProgress(ScraperProgressTypes.Terminating);
    if (!_success && !!this.options.storeFailureScreenShotPath) {
      LOG.info('snapshot before terminate in %s', this.options.storeFailureScreenShotPath);
      await this.page
        .screenshot({ path: this.options.storeFailureScreenShotPath, fullPage: true })
        .catch((e: unknown) => {
          LOG.info('screenshot failed: %s', (e as Error).message.slice(0, 80));
        });
    }
    await Promise.all(this.cleanups.reverse().map(safeCleanup));
    this.cleanups = [];
  }

  private buildFieldConfig(field: { selector: string; credentialKey?: string }): FieldConfig {
    const key = field.credentialKey ?? extractCredentialKey(field.selector);
    return { credentialKey: key, selectors: [{ kind: 'css', value: field.selector }] };
  }

  private async fillOneInput(
    pageOrFrame: Page | Frame,
    field: { selector: string; value: string; credentialKey?: string },
  ): Promise<void> {
    const fc = this.buildFieldConfig(field);
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
    this.cleanups.push(() => page.close());
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
    if (registerContextCleanup) this.cleanups.push(async () => context.close());
    return context.newPage();
  }

  private registerBrowserCleanup(browser: Browser): void {
    this.cleanups.push(async () => {
      LOG.info('closing the browser');
      await browser.close();
    });
  }

  private async launchNewBrowser(): Promise<Page> {
    const opts = this.options as DefaultBrowserOptions;
    const { shouldShowBrowser } = opts;
    LOG.info('launch Camoufox browser headless=%s', !shouldShowBrowser);
    const browser = await launchCamoufox(!shouldShowBrowser);
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

  private isSuccessStatus(status: number): boolean {
    return status === 200 || (status >= 300 && status < 400);
  }

  private async navigateAfterDelay(
    url: string,
    waitUntil: WaitUntilState | undefined,
    attempt: number,
  ): Promise<number> {
    const delayMs = 15_000;
    const max = BaseScraperWithBrowser.MAX_403_RETRIES;
    LOG.info('WAF 403 on %s, retry %d/%d after %ds', url, attempt + 1, max, delayMs / 1000);
    await sleep(delayMs);
    return (await this.page.goto(url, { waitUntil }))?.status() ?? 0;
  }

  private async retryOn403(
    url: string,
    waitUntil: WaitUntilState | undefined,
    attempt = 0,
  ): Promise<void> {
    const maxRetries = BaseScraperWithBrowser.MAX_403_RETRIES;
    if (attempt >= maxRetries)
      throw new Error(
        `Failed to navigate to url ${url}, status code: 403 (after ${maxRetries} retries)`,
      );
    const currentStatus = await this.navigateAfterDelay(url, waitUntil, attempt);
    if (this.isSuccessStatus(currentStatus)) {
      LOG.info('WAF 403 resolved after retry %d', attempt + 1);
      return;
    }
    return this.retryOn403(url, waitUntil, attempt + 1);
  }

  // ─── Login chain steps ────────────────────────────────────────────────────

  private async stepNavigate(loginOptions: LoginOptions): Promise<StepResult> {
    this.diagState.loginUrl = loginOptions.loginUrl;
    await this.navigateTo(loginOptions.loginUrl, loginOptions.waitUntil);
    if (loginOptions.checkReadiness) {
      await loginOptions.checkReadiness();
    } else if (typeof loginOptions.submitButtonSelector === 'string') {
      await waitUntilElementFound(this.page, loginOptions.submitButtonSelector);
    }
    LOG.info('login[1] navigate + checkReadiness passed url=%s', this.page.url());
    return CONTINUE;
  }

  private async stepFillAndSubmit(loginOptions: LoginOptions, ctx: LoginContext): Promise<StepResult> {
    let loginFrameOrPage: Page | Frame = this.page;
    if (loginOptions.preAction) loginFrameOrPage = (await loginOptions.preAction()) ?? this.page;
    ctx.activeFrame = loginFrameOrPage;
    LOG.info('login[2] fill %d fields', loginOptions.fields.length);
    await this.fillInputs(loginFrameOrPage, loginOptions.fields);
    const submitCtx = this.activeLoginContext ?? loginFrameOrPage;
    if (typeof loginOptions.submitButtonSelector === 'string') {
      await clickButton(submitCtx, loginOptions.submitButtonSelector);
    } else {
      await loginOptions.submitButtonSelector();
    }
    this.emitProgress(ScraperProgressTypes.LoggingIn);
    return CONTINUE;
  }

  private async stepWaitAfterSubmit(): Promise<StepResult> {
    await sleep(1500);
    LOG.info('login[3] post-submit url=%s', this.page.url());
    return CONTINUE;
  }

  private async stepCheckEarlyResult(loginOptions: LoginOptions): Promise<StepResult> {
    try {
      const r = await getKeyByValue(loginOptions.possibleResults, this.page.url(), this.page);
      if (r !== LOGIN_RESULTS.UnknownError) return stopWithResult(this.handleLoginResult(r));
    } catch {
      // page.url() may throw — continue chain
    }
    return CONTINUE;
  }

  private otpPhoneHint = '';

  private async stepOtpConfirm(): Promise<StepResult> {
    LOG.info('login[5a] OTP confirm — send SMS');
    this.otpPhoneHint = await handleOtpConfirm(this.page);
    return CONTINUE;
  }

  private async stepOtpCode(): Promise<StepResult> {
    LOG.info('login[5b] OTP code entry');
    const otpResult = await handleOtpCode(this.page, this.options, this.otpPhoneHint);
    if (otpResult !== null) return stopWithResult(otpResult);
    return CONTINUE;
  }

  private async stepSecondLogin(loginOptions: LoginOptions): Promise<StepResult> {
    LOG.info('login[6] second login step (Max Flow B)');
    if (loginOptions.postAction) {
      await loginOptions.postAction();
    }
    return CONTINUE;
  }

  private async stepPostAction(loginOptions: LoginOptions): Promise<StepResult> {
    if (loginOptions.postAction) {
      await loginOptions.postAction();
    } else {
      await waitForNavigation(this.page);
    }
    return CONTINUE;
  }

  private async resolveLoginResult(loginOptions: LoginOptions): Promise<ScraperScrapingResult> {
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
    throw new Error(`unexpected login result "${loginResult}"`);
  }
}

export { BaseScraperWithBrowser };
