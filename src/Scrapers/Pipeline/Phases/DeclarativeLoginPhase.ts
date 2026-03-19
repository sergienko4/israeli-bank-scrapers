/**
 * Declarative login phase — bridges ILoginConfig → LoginChainBuilder.
 * Generic for ALL banks: navigate → parse → fill → submit → wait → check → post.
 * Bank provides only ILoginConfig (URLs, field keys, results). Pipeline executes.
 */

import type { Frame, Page } from 'playwright-core';

import type { ILoginContext, INamedLoginStep } from '../../../Common/LoginMiddleware.js';
import { runLoginChain } from '../../../Common/LoginMiddleware.js';
import { candidateToCss } from '../../../Common/SelectorResolver.js';
import type { ILoginOptions } from '../../Base/BaseScraperHelpers.js';
import type { SelectorCandidate } from '../../Base/Config/LoginConfigTypes.js';
import { ScraperErrorTypes } from '../../Base/ErrorTypes.js';
import type { ScraperCredentials, ScraperOptions } from '../../Base/Interface.js';
import type { ILoginConfig } from '../../Base/Interfaces/Config/LoginConfig.js';
import buildLoginChain from '../../Base/LoginChainBuilder.js';
import { fillOneInput, type ILoginStepContext } from '../../Base/LoginSteps.js';
import { SCRAPER_CONFIGURATION } from '../../Registry/Config/ScraperConfig.js';
import type { IBankScraperConfig } from '../../Registry/Config/ScraperConfigDefaults.js';
import { none, some } from '../Types/Option.js';
import type { IPipelineStep } from '../Types/Phase.js';
import type { IPipelineContext } from '../Types/PipelineContext.js';
import type { Procedure } from '../Types/Procedure.js';
import { fail, fromLegacy, isOk, succeed } from '../Types/Procedure.js';

/** Login result keys (matches BaseScraperHelpers LOGIN_RESULTS). */
const SUCCESS = 'SUCCESS';
const INVALID_PW = 'INVALID_PASSWORD';
const CHANGE_PW = 'CHANGE_PASSWORD';

type OptionalFramePromise = Promise<Frame | undefined>;

// ── Config → ILoginOptions conversion ─────────────────────

/**
 * Build field list from config + credentials.
 * @param config - Bank login config.
 * @param creds - User credentials.
 * @returns Fields with CSS selector, value, and key.
 */
function buildFields(config: ILoginConfig, creds: ScraperCredentials): ILoginOptions['fields'] {
  const credsMap = creds as Record<string, string>;
  return config.fields.map(f => ({
    selector: f.selectors.length > 0 ? candidateToCss(f.selectors[0]) : '',
    value: credsMap[f.credentialKey] ?? '',
    credentialKey: f.credentialKey,
  }));
}

/**
 * Normalize submit selector to array.
 * @param submit - Single or array of candidates.
 * @returns Array of selector candidates.
 */
function submitArray(submit: ILoginConfig['submit']): SelectorCandidate[] {
  if (Array.isArray(submit)) return [...submit] as SelectorCandidate[];
  return [submit];
}

/**
 * Map ILoginConfig possibleResults to PossibleLoginResults.
 * @param pr - Config possible results.
 * @returns Mapped results keyed by login outcome.
 */
function mapResults(pr: ILoginConfig['possibleResults']): ILoginOptions['possibleResults'] {
  const mapped: ILoginOptions['possibleResults'] = { [SUCCESS]: pr.success };
  if (pr.invalidPassword) mapped[INVALID_PW] = pr.invalidPassword;
  if (pr.changePassword) mapped[CHANGE_PW] = pr.changePassword;
  return mapped;
}

/**
 * Build lifecycle callbacks from config.
 * @param config - Bank login config.
 * @param page - Browser page.
 * @returns Callbacks for checkReadiness, preAction, postAction.
 */
function buildCallbacks(config: ILoginConfig, page: Page): Partial<ILoginOptions> {
  const cbs: Partial<ILoginOptions> = {};
  if (config.checkReadiness) {
    /**
     * Awaits bank-provided readiness check before login form interaction.
     * @returns True when ready.
     */
    cbs.checkReadiness = async (): Promise<boolean> => {
      await config.checkReadiness?.(page);
      return true;
    };
  }
  if (config.preAction) {
    /**
     * Opens the login form (popup/iframe) via bank preAction.
     * @returns Login frame or undefined.
     */
    cbs.preAction = (): OptionalFramePromise =>
      config.preAction?.(page) ?? Promise.resolve(undefined);
  }
  if (config.postAction) {
    /**
     * Awaits bank-provided post-login action (redirect, modal dismiss).
     * @returns True when done.
     */
    cbs.postAction = async (): Promise<boolean> => {
      await config.postAction?.(page);
      return true;
    };
  }
  return cbs;
}

/**
 * Convert ILoginConfig → ILoginOptions.
 * @param config - Bank login config.
 * @param page - Browser page.
 * @param creds - User credentials.
 * @returns Login options for the chain builder.
 */
function toLoginOptions(
  config: ILoginConfig,
  page: Page,
  creds: ScraperCredentials,
): ILoginOptions {
  const submitCandidates = submitArray(config.submit);
  const submitCss = candidateToCss(submitCandidates[0]);
  return {
    loginUrl: config.loginUrl,
    fields: buildFields(config, creds),
    submitButtonSelector: submitCss,
    ...buildCallbacks(config, page),
    possibleResults: mapResults(config.possibleResults),
    waitUntil: config.waitUntil,
  };
}

// ── Step context builders ──────────────────────────────────

/**
 * Build a fresh diagState for a login context.
 * @returns Initial diagState with default values.
 */
function buildLoginDiagState(): ILoginStepContext['diagState'] {
  return { loginUrl: '', loginStartMs: Date.now(), lastAction: 'login', warnings: [] } as never;
}

/**
 * Build the navigateTo callback bound to a page.
 * @param page - Browser page.
 * @returns Async navigate function.
 */
function buildNavigateFn(page: Page): ILoginStepContext['navigateTo'] {
  return async (url, waitUntil): Promise<boolean> => {
    const navOpts = waitUntil ? { waitUntil: waitUntil as 'load' } : {};
    await page.goto(url, navOpts);
    return true;
  };
}

/**
 * Always returns true — pipeline context does not track granular progress.
 * @returns True.
 */
const ALWAYS_TRUE = (): boolean => true;

/**
 * Build the loginResultCtx callback bound to a page.
 * @param page - Browser page.
 * @returns loginResultCtx function for the step context.
 */
function buildResultCtxFn(page: Page): ILoginStepContext['loginResultCtx'] {
  return () => ({ page, diagState: buildLoginDiagState(), emitProgress: ALWAYS_TRUE });
}

/**
 * Build the fillInputs callback that fills fields sequentially.
 * @param ctx - The step context owning this callback.
 * @returns fillInputs function for the step context.
 */
function buildFillInputsFn(ctx: ILoginStepContext): ILoginStepContext['fillInputs'] {
  return async (frameOrPage, fields): Promise<boolean> => {
    const initial: Promise<boolean> = Promise.resolve(true);
    await fields.reduce<Promise<boolean>>(async (prev, field) => {
      await prev;
      return fillOneInput(ctx, frameOrPage, field);
    }, initial);
    return true;
  };
}

/**
 * Placeholder fillInputs — replaced by buildFillInputsFn after context is created.
 * @returns Resolved true immediately.
 */
const NOOP_FILL = (): Promise<boolean> => Promise.resolve(true);

/**
 * Build ILoginStepContext skeleton (fillInputs replaced after creation).
 * @param page - Browser page.
 * @param options - Scraper options.
 * @returns Step context with placeholder fillInputs.
 */
function buildStepCtxBase(page: Page, options: ScraperOptions): ILoginStepContext {
  return {
    page,
    activeLoginContext: page,
    currentParsedPage: undefined,
    otpPhoneHint: '',
    otpTriggerSelectors: undefined,
    diagState: buildLoginDiagState(),
    emitProgress: ALWAYS_TRUE,
    navigateTo: buildNavigateFn(page),
    fillInputs: NOOP_FILL,
    loginResultCtx: buildResultCtxFn(page),
    options,
  } as ILoginStepContext;
}

/**
 * Build ILoginStepContext from pipeline context.
 * @param page - Browser page.
 * @param options - Scraper options.
 * @returns Step context for LoginChainBuilder.
 */
function buildStepCtx(page: Page, options: ScraperOptions): ILoginStepContext {
  const ctx = buildStepCtxBase(page, options);
  ctx.fillInputs = buildFillInputsFn(ctx);
  return ctx;
}

// ── Execute login ──────────────────────────────────────────

/**
 * Build ILoginContext for the chain runner.
 * @param page - Browser page.
 * @param bankConfig - Bank scraper config with loginSetup.
 * @returns ILoginContext with page + setup.
 */
function buildLoginCtx(page: Page, bankConfig: IBankScraperConfig): ILoginContext {
  return { page, activeFrame: page, loginSetup: bankConfig.loginSetup };
}

/**
 * Set up options + context, run the login chain, return result or loginCtx.
 * @param config - Bank login config.
 * @param ctx - Pipeline context.
 * @param page - Browser page.
 * @returns Updated ILoginContext on success, or failure procedure.
 */
async function setupAndRunChain(
  config: ILoginConfig,
  ctx: IPipelineContext,
  page: Page,
): Promise<Procedure<ILoginContext>> {
  const bankConfig = SCRAPER_CONFIGURATION.banks[ctx.companyId];
  const loginOptions = toLoginOptions(config, page, ctx.credentials);
  const loginCtx = buildLoginCtx(page, bankConfig);
  const stepCtx = buildStepCtx(page, ctx.options);
  const steps: INamedLoginStep[] = buildLoginChain(stepCtx, loginOptions, loginCtx);
  const execFns = steps.map(s => s.execute);
  const chainResult = await runLoginChain(execFns, loginCtx);
  if (chainResult) {
    const proc = fromLegacy(chainResult);
    if (!isOk(proc)) return proc;
  }
  return succeed(loginCtx);
}

/**
 * Run declarative login using the chain builder.
 * @param config - Bank's ILoginConfig.
 * @param ctx - Pipeline context with browser + credentials.
 * @returns Updated context with login state.
 */
async function executeLogin(
  config: ILoginConfig,
  ctx: IPipelineContext,
): Promise<Procedure<IPipelineContext>> {
  if (!ctx.browser.has) return fail(ScraperErrorTypes.Generic, 'No browser for login');
  const page = ctx.browser.value.page;
  const loginCtxResult = await setupAndRunChain(config, ctx, page);
  if (!loginCtxResult.ok) return loginCtxResult;
  const loginCtx = loginCtxResult.value;
  const loginState = {
    activeFrame: loginCtx.activeFrame,
    formAnchor: none(),
    persistentOtpToken: none(),
  };
  return succeed({ ...ctx, login: some(loginState) });
}

// ── Phase step factories ───────────────────────────────────

/** Bank-provided login function signature. */
type LoginFn = (ctx: IPipelineContext) => Promise<Procedure<IPipelineContext>>;

/**
 * Create a login step from an ILoginConfig.
 * @param config - Bank's login configuration.
 * @returns Pipeline step that executes the login chain.
 */
function createConfigLoginStep(
  config: ILoginConfig,
): IPipelineStep<IPipelineContext, IPipelineContext> {
  return {
    name: 'declarative-login',
    /**
     * Execute the declarative login chain for this bank config.
     * @param _ctx - Unused pipeline context.
     * @param input - Context with browser state.
     * @returns Updated context with login state.
     */
    async execute(
      _ctx: IPipelineContext,
      input: IPipelineContext,
    ): Promise<Procedure<IPipelineContext>> {
      return executeLogin(config, input);
    },
  };
}

/**
 * Create a login step from a custom function.
 * @param loginFn - Bank's custom login function.
 * @returns Pipeline step for login.
 */
function createLoginStep(loginFn: LoginFn): IPipelineStep<IPipelineContext, IPipelineContext> {
  return {
    name: 'declarative-login',
    /**
     * Execute the custom login function provided by the bank.
     * @param _ctx - Unused pipeline context.
     * @param input - Context with browser state.
     * @returns Login result from the bank-provided function.
     */
    async execute(
      _ctx: IPipelineContext,
      input: IPipelineContext,
    ): Promise<Procedure<IPipelineContext>> {
      return loginFn(input);
    },
  };
}

/**
 * Default stub — passes through for testing.
 * @param _ctx - Unused.
 * @param input - Passed through.
 * @returns Success with unchanged context.
 */
function stubLogin(
  _ctx: IPipelineContext,
  input: IPipelineContext,
): Promise<Procedure<IPipelineContext>> {
  const result = succeed(input);
  return Promise.resolve(result);
}

/** Default stub step. */
const DECLARATIVE_LOGIN_STEP: IPipelineStep<IPipelineContext, IPipelineContext> = {
  name: 'declarative-login',
  execute: stubLogin,
};

export type { LoginFn };
export default DECLARATIVE_LOGIN_STEP;
export { createConfigLoginStep, createLoginStep, DECLARATIVE_LOGIN_STEP };
