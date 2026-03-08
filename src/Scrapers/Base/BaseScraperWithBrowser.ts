/* eslint-disable max-lines -- ESM .js import paths cause Prettier line-wrapping beyond 300 */
import type { Browser, Frame, Page } from 'playwright';

import { buildContextOptions } from '../../Common/Browser.js';
import { launchCamoufox } from '../../Common/CamoufoxLauncher.js';
import { runLoggedChain } from '../../Common/ChainLogger.js';
import { getDebug } from '../../Common/Debug.js';
import {
  clickButton,
  fillInput,
  waitUntilElementFound,
} from '../../Common/ElementsInteractions.js';
import {
  CONTINUE,
  type LoginContext,
  type NamedLoginStep,
  type ParsedLoginPage,
  type StepResult,
  stopWithResult,
} from '../../Common/LoginMiddleware.js';
import { waitForNavigation, type WaitUntilState } from '../../Common/Navigation.js';
import { handleOtpCode, handleOtpConfirm } from '../../Common/OtpHandler.js';
import {
  extractCredentialKey,
  type FieldContext,
  resolveFieldContext,
  resolveFieldWithCache,
} from '../../Common/SelectorResolver.js';
import { sleep } from '../../Common/Waiting.js';
import { ScraperProgressTypes } from '../../Definitions.js';
import { SCRAPER_CONFIGURATION } from '../Registry/ScraperConfig.js';
import { BaseScraper } from './BaseScraper.js';
import {
  buildLoginResult,
  getKeyByValue,
  LOGIN_RESULTS,
  type LoginOptions,
  type LoginResultContext,
  type LoginResults,
  type PossibleLoginResults,
  resolveAndBuildLoginResult,
  safeCleanup,
} from './BaseScraperHelpers.js';
import type {
  DefaultBrowserOptions,
  ScraperCredentials,
  ScraperScrapingResult,
} from './Interface.js';
import type { FieldConfig } from './LoginConfig.js';

export { LOGIN_RESULTS, type LoginOptions, type LoginResults, type PossibleLoginResults };

const LOG = getDebug('base-scraper-with-browser');

class BaseScraperWithBrowser<
  TCredentials extends ScraperCredentials,
> extends BaseScraper<TCredentials> {
  private static readonly MAX_403_RETRIES = 2;

  protected activeLoginContext: Page | Frame | null = null;

  protected page!: Page;

  private cleanups: (() => Promise<void>)[] = [];

  private otpPhoneHint = '';

  private currentParsedPage?: ParsedLoginPage;

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
    const chainResult = await runLoggedChain(steps, ctx, LOG);
    if (chainResult !== null) return chainResult;
    return resolveAndBuildLoginResult(this.loginResultCtx(), loginOptions.possibleResults);
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

  private loginResultCtx(): LoginResultContext {
    return {
      page: this.page,
      diagState: this.diagState,
      emitProgress: (t): void => {
        this.emitProgress(t);
      },
    };
  }

  private buildLoginChain(loginOptions: LoginOptions, ctx: LoginContext): NamedLoginStep[] {
    const steps: NamedLoginStep[] = [];
    steps.push({ name: 'navigate', execute: () => this.stepNavigate(loginOptions) });
    steps.push({ name: 'parse-page', execute: () => this.stepParseLoginPage(ctx) });
    steps.push({ name: 'fill', execute: () => this.stepFillAndSubmit(loginOptions, ctx) });
    steps.push({ name: 'wait', execute: () => this.stepWaitAfterSubmit() });
    steps.push({ name: 'check-result', execute: () => this.stepCheckEarlyResult(loginOptions) });
    if (ctx.loginSetup.hasOtpConfirm) {
      steps.push({ name: 'otp-confirm', execute: () => this.stepOtpConfirm() });
    }
    if (ctx.loginSetup.hasOtpCode) {
      steps.push({ name: 'otp-code', execute: () => this.stepOtpCode() });
    }
    if (ctx.loginSetup.hasSecondLoginStep) {
      steps.push({ name: 'second-login', execute: () => this.stepSecondLogin(loginOptions) });
    }
    steps.push({ name: 'post-action', execute: () => this.stepPostAction(loginOptions) });
    return steps;
  }

  private async resolveField(ctx: Page | Frame, fc: FieldConfig): Promise<FieldContext> {
    const url = this.page.url();
    if (!this.currentParsedPage) return resolveFieldContext(ctx, fc, url);
    return resolveFieldWithCache({
      pageOrFrame: ctx,
      field: fc,
      pageUrl: url,
      cachedFrames: this.currentParsedPage.childFrames,
    });
  }

  private async fillOneInput(
    pageOrFrame: Page | Frame,
    field: { selector: string; value: string; credentialKey?: string },
  ): Promise<void> {
    const key = field.credentialKey ?? extractCredentialKey(field.selector);
    const fc = { credentialKey: key, selectors: [{ kind: 'css' as const, value: field.selector }] };
    const result = await this.resolveField(this.activeLoginContext ?? pageOrFrame, fc);
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

  private async launchNewBrowser(): Promise<Page> {
    const opts = this.options as DefaultBrowserOptions;
    const { shouldShowBrowser } = opts;
    LOG.info('launch Camoufox browser headless=%s', !shouldShowBrowser);
    const browser = await launchCamoufox(!shouldShowBrowser);
    this.cleanups.push(async () => {
      LOG.info('closing the browser');
      await browser.close();
    });
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
      if (!this.options.skipCloseBrowser) {
        this.cleanups.push(async () => {
          LOG.info('closing the browser');
          await browser.close();
        });
      }
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
    const status = await this.navigateAfterDelay(url, waitUntil, attempt);
    if (status === 200 || (status >= 300 && status < 400)) {
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

  // eslint-disable-next-line @typescript-eslint/require-await
  private async stepParseLoginPage(ctx: LoginContext): Promise<StepResult> {
    const childFrames = this.collectAccessibleFrames();
    ctx.parsedPage = {
      childFrames,
      loginFormContext: null,
      pageUrl: this.page.url(),
      bodyText: '', // lazy — captured on demand by OTP detection, not eagerly
    };
    this.currentParsedPage = ctx.parsedPage;
    LOG.info('login[1b] parsed: %d child frames', childFrames.length);
    return CONTINUE;
  }

  private collectAccessibleFrames(): Frame[] {
    try {
      return this.page.frames().filter(f => f !== this.page.mainFrame());
    } catch {
      return [];
    }
  }

  private async stepFillAndSubmit(
    loginOptions: LoginOptions,
    ctx: LoginContext,
  ): Promise<StepResult> {
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
      if (r !== LOGIN_RESULTS.UnknownError)
        return stopWithResult(buildLoginResult(this.loginResultCtx(), r));
    } catch {
      // page.url() may throw — continue chain
    }
    return CONTINUE;
  }

  private async stepOtpConfirm(): Promise<StepResult> {
    LOG.info('login[5a] OTP confirm — send SMS');
    this.otpPhoneHint = await handleOtpConfirm(this.page, this.currentParsedPage);
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
}

export { BaseScraperWithBrowser };
