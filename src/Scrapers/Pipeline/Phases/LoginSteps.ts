/**
 * Login phase — split into preLogin, loginAction, postLogin.
 * Generic for ALL banks. Bank provides only ILoginConfig.
 *
 * preLogin:    navigate + checkReadiness + preAction (open form)
 * loginAction: PURE fill fields + click submit — via ctx.mediator (black box)
 * postLogin:   wait for settle + mediator.discoverErrors + postAction
 *
 * ARCHITECTURE: LoginSteps NEVER imports HTML utilities directly.
 * All HTML resolution flows through ctx.mediator (injected by InitPhase).
 */

import type { Frame, Page } from 'playwright-core';

import { fillInput } from '../../../Common/ElementsInteractions.js';
import type { SelectorCandidate } from '../../Base/Config/LoginConfigTypes.js';
import { ScraperErrorTypes } from '../../Base/ErrorTypes.js';
import type { IFieldConfig } from '../../Base/Interfaces/Config/FieldConfig.js';
import type { ILoginConfig } from '../../Base/Interfaces/Config/LoginConfig.js';
import type { IElementMediator } from '../Mediator/ElementMediator.js';
import { PIPELINE_WELL_KNOWN_LOGIN } from '../Registry/PipelineWellKnown.js';
import { none, some } from '../Types/Option.js';
import type { IPipelineStep } from '../Types/Phase.js';
import type { IPipelineContext } from '../Types/PipelineContext.js';
import type { Procedure } from '../Types/Procedure.js';
import { fail, succeed } from '../Types/Procedure.js';

// ── Types ──────────────────────────────────────────────────

/** Options for filling a single credential field. */
export interface IFillOpts {
  readonly credentialKey: string;
  readonly value: string;
  readonly selectors: readonly SelectorCandidate[];
}

// ── preLogin helpers ───────────────────────────────────────

/**
 * Navigate to login URL.
 * @param page - Browser page.
 * @param loginUrl - Target URL.
 * @returns True after navigation.
 */
async function navigateToLogin(page: Page, loginUrl: string): Promise<boolean> {
  await page.goto(loginUrl, { waitUntil: 'domcontentloaded' });
  return true;
}

/**
 * Run checkReadiness callback if provided.
 * @param page - Browser page.
 * @param config - Login config with optional checkReadiness.
 * @returns True when ready.
 */
async function runCheckReadiness(page: Page, config: ILoginConfig): Promise<boolean> {
  if (config.checkReadiness) await config.checkReadiness(page);
  return true;
}

/**
 * Run preAction callback if provided (opens popup/iframe).
 * @param page - Browser page.
 * @param config - Login config with optional preAction.
 * @returns The login frame (if iframe), or the page itself.
 */
async function runPreAction(page: Page, config: ILoginConfig): Promise<Page | Frame> {
  if (!config.preAction) return page;
  const frame = await config.preAction(page);
  return frame ?? page;
}

/**
 * Try to click the login method selection tab if present on the current page.
 * Generic for ALL banks — banks without a method-selection page: all candidates
 * reject within 2s (timeout) and the function silently returns false.
 * Banks with a tab (e.g. VisaCal send-otp): clicks "כניסה עם שם משתמש" or
 * "כניסה עם סיסמה" and returns true, navigating to the credentials form.
 * Uses PIPELINE_WELL_KNOWN_LOGIN.loginMethodTab — zero CSS, visible text only.
 * @param activeFrame - Page or iframe returned by preAction.
 * @returns True if a tab was found and clicked, false if not present.
 */
export async function tryClickLoginMethodTab(activeFrame: Page | Frame): Promise<boolean> {
  const candidates = PIPELINE_WELL_KNOWN_LOGIN.loginMethodTab;
  const locators = candidates.map(c => activeFrame.getByText(c.value).first());
  try {
    const waiters = locators.map(async (loc, i): Promise<number> => {
      await loc.waitFor({ state: 'visible', timeout: 2000 });
      return i;
    });
    const idx = await Promise.any(waiters);
    await locators[idx].click();
    return true;
  } catch {
    return false;
  }
}

/**
 * Execute the preLogin step body.
 * @param config - Bank's login config.
 * @param input - Current pipeline context.
 * @returns Updated context with login.activeFrame.
 */
async function executePreLogin(
  config: ILoginConfig,
  input: IPipelineContext,
): Promise<Procedure<IPipelineContext>> {
  if (!input.browser.has) return fail(ScraperErrorTypes.Generic, 'No browser for preLogin');
  const page = input.browser.value.page;
  await navigateToLogin(page, config.loginUrl);
  await runCheckReadiness(page, config);
  const activeFrame = await runPreAction(page, config);
  await tryClickLoginMethodTab(activeFrame);
  const loginState = { activeFrame, persistentOtpToken: none() };
  return succeed({ ...input, login: some(loginState) });
}

/**
 * Create the preLogin step.
 * @param config - Bank's login config.
 * @returns Pipeline step: navigate + readiness + preAction.
 */
function createPreLoginStep(
  config: ILoginConfig,
): IPipelineStep<IPipelineContext, IPipelineContext> {
  return {
    name: 'pre-login',
    /**
     * Execute preLogin: navigate to login URL, wait for readiness, open form.
     * @param _ctx - Unused pipeline context.
     * @param input - Context to extend with login.activeFrame.
     * @returns Updated context.
     */
    async execute(
      _ctx: IPipelineContext,
      input: IPipelineContext,
    ): Promise<Procedure<IPipelineContext>> {
      return executePreLogin(config, input);
    },
  };
}

// ── loginAction helpers ────────────────────────────────────

/**
 * Fill one credential field via mediator (black box — no direct HTML access).
 * @param mediator - IElementMediator from pipeline context.
 * @param opts - Fill options: credentialKey, value, selectors.
 * @returns Procedure<boolean> — fails if field not found.
 */
async function fillOneField(
  mediator: IElementMediator,
  opts: IFillOpts,
): Promise<Procedure<boolean>> {
  const result = await mediator.resolveField(opts.credentialKey, opts.selectors);
  if (!result.ok) return result;
  await fillInput(result.value.context, result.value.selector, opts.value);
  return succeed(true);
}

/**
 * Validate all required credentials are present and non-empty.
 * @param fields - Field configs from login config.
 * @param creds - Credentials map.
 * @returns Success if all present, failure listing missing keys.
 */
function validateCredentials(
  fields: ILoginConfig['fields'],
  creds: Record<string, string>,
): Procedure<boolean> {
  const missing = fields.filter(f => !creds[f.credentialKey]).map(f => f.credentialKey);
  if (missing.length > 0) {
    const keys = missing.join(', ');
    return fail(ScraperErrorTypes.Generic, `Missing credentials: ${keys}`);
  }
  return succeed(true);
}

/**
 * Build fill options for a single credential field.
 * @param field - Field config from login config.
 * @param creds - Credentials map (validated non-empty by validateCredentials).
 * @returns Fill options with credentialKey, value, and selectors.
 */
function buildFillOpts(field: IFieldConfig, creds: Record<string, string>): IFillOpts {
  const value = creds[field.credentialKey];
  return { credentialKey: field.credentialKey, value, selectors: field.selectors };
}

/**
 * Fill all credential fields sequentially via mediator.
 * Short-circuits on first field failure — does not attempt remaining fields.
 * @param mediator - IElementMediator from pipeline context.
 * @param fields - Field configs from login config.
 * @param creds - Credentials map.
 * @returns Procedure<boolean> — fails if any field is not found.
 */
async function fillAllFields(
  mediator: IElementMediator,
  fields: ILoginConfig['fields'],
  creds: Record<string, string>,
): Promise<Procedure<boolean>> {
  const validation = validateCredentials(fields, creds);
  if (!validation.ok) return validation;
  const firstResult = succeed(true);
  const initial: Promise<Procedure<boolean>> = Promise.resolve(firstResult);
  return fields.reduce<Promise<Procedure<boolean>>>(async (prev, field) => {
    const prevResult = await prev;
    if (!prevResult.ok) return prevResult;
    const opts = buildFillOpts(field, creds);
    return fillOneField(mediator, opts);
  }, initial);
}

/**
 * Normalize submit config to array.
 * @param submit - Single or array of candidates.
 * @returns Array of candidates.
 */
function normalizeSubmit(submit: ILoginConfig['submit']): SelectorCandidate[] {
  if (Array.isArray(submit)) return [...submit] as SelectorCandidate[];
  return [submit];
}

/**
 * Click the submit button via mediator (black box — searches iframes automatically).
 * WellKnown __submit__ fallback is handled internally by the mediator.
 * @param mediator - IElementMediator from pipeline context.
 * @param submitCandidates - Bank-provided submit selector candidates.
 * @returns Procedure<boolean> — fails if submit button not found.
 */
async function clickSubmit(
  mediator: IElementMediator,
  submitCandidates: SelectorCandidate[],
): Promise<Procedure<boolean>> {
  const result = await mediator.resolveClickable(submitCandidates);
  if (!result.ok) return result;
  const locator = result.value.context.locator(result.value.selector);
  const btn = locator.first();
  await btn.click();
  return succeed(true);
}

/**
 * Execute the loginAction step body.
 * @param config - Bank's login config.
 * @param input - Context with login.activeFrame from preLogin.
 * @returns Same context after filling + submitting, or failure.
 */
async function executeLoginAction(
  config: ILoginConfig,
  input: IPipelineContext,
): Promise<Procedure<IPipelineContext>> {
  if (!input.login.has) return fail(ScraperErrorTypes.Generic, 'No login context from preLogin');
  if (!input.mediator.has) return fail(ScraperErrorTypes.Generic, 'No mediator in context');
  const mediator = input.mediator.value;
  const creds = input.credentials as Record<string, string>;
  const fillResult = await fillAllFields(mediator, config.fields, creds);
  if (!fillResult.ok) return fillResult;
  const submitCandidates = normalizeSubmit(config.submit);
  const clickResult = await clickSubmit(mediator, submitCandidates);
  if (!clickResult.ok) return clickResult;
  return succeed(input);
}

/**
 * Create the loginAction step.
 * @param config - Bank's login config.
 * @returns Pipeline step: fill fields + click submit via mediator.
 */
function createLoginActionStep(
  config: ILoginConfig,
): IPipelineStep<IPipelineContext, IPipelineContext> {
  return {
    name: 'login-action',
    /**
     * Execute loginAction: fill credential fields and click the submit button.
     * @param _ctx - Unused pipeline context.
     * @param input - Context with login.activeFrame from preLogin.
     * @returns Same context after filling and submitting.
     */
    async execute(
      _ctx: IPipelineContext,
      input: IPipelineContext,
    ): Promise<Procedure<IPipelineContext>> {
      return executeLoginAction(config, input);
    },
  };
}

// ── postLogin helpers ──────────────────────────────────────

/**
 * Wait for the page to reach networkidle after form submission.
 * Uses networkidle instead of waitForURL('**') to avoid SPA hash-routing false positives
 * (Angular/React apps already have a '#' URL before the form is submitted).
 * @param page - Browser main page.
 * @returns True after settling or timeout.
 */
export async function waitForSubmitToSettle(page: Page): Promise<boolean> {
  try {
    await page.waitForLoadState('networkidle', { timeout: 15000 });
  } catch {
    // Timeout is OK — SPA may stay "loading"; proceed and check for errors
  }
  return true;
}

/**
 * Run postAction callback if provided.
 * @param page - Browser page.
 * @param config - Login config with optional postAction.
 * @returns True when done.
 */
async function runPostAction(page: Page, config: ILoginConfig): Promise<boolean> {
  if (config.postAction) await config.postAction(page);
  return true;
}

/**
 * Execute the postLogin step body.
 * Generic: wait for settle → mediator.discoverErrors (Layer1+Layer2) → postAction.
 * @param config - Bank's login config.
 * @param input - Context from loginAction.
 * @returns Success or login error.
 */
async function executePostLogin(
  config: ILoginConfig,
  input: IPipelineContext,
): Promise<Procedure<IPipelineContext>> {
  if (!input.browser.has) return fail(ScraperErrorTypes.Generic, 'No browser for postLogin');
  if (!input.login.has) return fail(ScraperErrorTypes.Generic, 'No login state for postLogin');
  if (!input.mediator.has) return fail(ScraperErrorTypes.Generic, 'No mediator for postLogin');
  const page = input.browser.value.page;
  const activeFrame = input.login.value.activeFrame;
  const mediator = input.mediator.value;
  await waitForSubmitToSettle(page);
  const errors = await mediator.discoverErrors(activeFrame);
  if (errors.hasErrors) {
    return fail(ScraperErrorTypes.InvalidPassword, `Form error: ${errors.summary}`);
  }
  await runPostAction(page, config);
  return succeed(input);
}

/**
 * Create the postLogin step.
 * @param config - Bank's login config.
 * @returns Pipeline step: wait + mediator error check + postAction.
 */
function createPostLoginStep(
  config: ILoginConfig,
): IPipelineStep<IPipelineContext, IPipelineContext> {
  return {
    name: 'post-login',
    /**
     * Execute postLogin: wait for settle, check errors via mediator, run postAction.
     * @param _ctx - Unused pipeline context.
     * @param input - Context from loginAction.
     * @returns Success or login error procedure.
     */
    async execute(
      _ctx: IPipelineContext,
      input: IPipelineContext,
    ): Promise<Procedure<IPipelineContext>> {
      return executePostLogin(config, input);
    },
  };
}

// ── Phase factory ──────────────────────────────────────────

/** Login phase with pre/action/post. */
interface ILoginPhase {
  readonly pre: IPipelineStep<IPipelineContext, IPipelineContext>;
  readonly action: IPipelineStep<IPipelineContext, IPipelineContext>;
  readonly post: IPipelineStep<IPipelineContext, IPipelineContext>;
}

/**
 * Create the full login phase from ILoginConfig.
 * @param config - Bank's login configuration.
 * @returns Pre, action, and post login steps.
 */
function createLoginPhase(config: ILoginConfig): ILoginPhase {
  return {
    pre: createPreLoginStep(config),
    action: createLoginActionStep(config),
    post: createPostLoginStep(config),
  };
}

export { createLoginActionStep, createLoginPhase, createPostLoginStep, createPreLoginStep };
