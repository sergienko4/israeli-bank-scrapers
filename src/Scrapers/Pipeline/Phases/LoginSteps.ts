/**
 * Login phase — split into preLogin, loginAction, postLogin.
 * Generic for ALL banks. Bank provides only ILoginConfig.
 *
 * preLogin:    navigate + checkReadiness + preAction (open form)
 * loginAction: PURE fill fields + click submit (via Mediator)
 * postLogin:   wait + check result + postAction
 */

import type { Frame, Page } from 'playwright-core';

import { fillInput } from '../../../Common/ElementsInteractions.js';
import { tryInContext } from '../../../Common/SelectorResolver.js';
import type { SelectorCandidate } from '../../Base/Config/LoginConfigTypes.js';
import { ScraperErrorTypes } from '../../Base/ErrorTypes.js';
import type { IFieldConfig } from '../../Base/Interfaces/Config/FieldConfig.js';
import type { ILoginConfig } from '../../Base/Interfaces/Config/LoginConfig.js';
import type { ILoginPossibleResults } from '../../Base/Interfaces/LoginPossibleResults.js';
import { resolveFieldPipeline } from '../Mediator/PipelineFieldResolver.js';
import { PIPELINE_WELL_KNOWN_LOGIN } from '../Registry/PipelineWellKnown.js';
import { none, some } from '../Types/Option.js';
import type { IPipelineStep } from '../Types/Phase.js';
import type { IPipelineContext } from '../Types/PipelineContext.js';
import type { Procedure } from '../Types/Procedure.js';
import { fail, succeed } from '../Types/Procedure.js';

// ── Types ──────────────────────────────────────────────────

/** Options for filling a single credential field. */
interface IFillOpts {
  readonly credentialKey: string;
  readonly value: string;
  readonly selectors: readonly SelectorCandidate[];
}

/** Condition type alias for possible login result checks. */
type ResultCondition = NonNullable<ILoginPossibleResults['invalidPassword']>[number];

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
  const loginState = { activeFrame, formAnchor: none(), persistentOtpToken: none() };
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
 * Fill one credential field using SelectorResolver.
 * @param frameOrPage - The context to fill in.
 * @param opts - Fill options: credentialKey, value, selectors.
 * @returns True after filling.
 */
async function fillOneField(frameOrPage: Page | Frame, opts: IFillOpts): Promise<boolean> {
  const resolved = await resolveFieldPipeline(frameOrPage, opts.credentialKey, opts.selectors);
  if (resolved.isResolved) await fillInput(resolved.context, resolved.selector, opts.value);
  return true;
}

/**
 * Build fill options for a single credential field.
 * @param field - Field config from login config.
 * @param creds - Credentials map.
 * @returns Fill options with credentialKey, value, and selectors.
 */
function buildFillOpts(field: IFieldConfig, creds: Record<string, string>): IFillOpts {
  const value = creds[field.credentialKey] ?? '';
  return { credentialKey: field.credentialKey, value, selectors: field.selectors };
}

/**
 * Fill all credential fields sequentially.
 * @param frameOrPage - The context to fill in.
 * @param fields - Field configs from login config.
 * @param creds - Credentials map.
 * @returns True after all fields are filled.
 */
async function fillAllFields(
  frameOrPage: Page | Frame,
  fields: ILoginConfig['fields'],
  creds: Record<string, string>,
): Promise<boolean> {
  const initial: Promise<boolean> = Promise.resolve(true);
  await fields.reduce<Promise<boolean>>(async (prev, field) => {
    await prev;
    const opts = buildFillOpts(field, creds);
    return fillOneField(frameOrPage, opts);
  }, initial);
  return true;
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
 * Click the submit button.
 * @param frameOrPage - The context containing the button.
 * @param submitCandidates - Selector candidates for submit.
 * @returns True after clicking.
 */
async function clickSubmit(
  frameOrPage: Page | Frame,
  submitCandidates: SelectorCandidate[],
): Promise<boolean> {
  const wkSubmit = [...PIPELINE_WELL_KNOWN_LOGIN.__submit__];
  const allCandidates = [...submitCandidates, ...wkSubmit];
  const css = await tryInContext(frameOrPage, allCandidates);
  if (css) {
    const locator = frameOrPage.locator(css);
    const btn = locator.first();
    await btn.click();
  }
  return true;
}

/**
 * Execute the loginAction step body.
 * @param config - Bank's login config.
 * @param input - Context with login.activeFrame from preLogin.
 * @returns Same context after filling + submitting.
 */
async function executeLoginAction(
  config: ILoginConfig,
  input: IPipelineContext,
): Promise<Procedure<IPipelineContext>> {
  if (!input.login.has) return fail(ScraperErrorTypes.Generic, 'No login context from preLogin');
  const activeFrame = input.login.value.activeFrame;
  const creds = input.credentials as Record<string, string>;
  await fillAllFields(activeFrame, config.fields, creds);
  const submitCandidates = normalizeSubmit(config.submit);
  await clickSubmit(activeFrame, submitCandidates);
  return succeed(input);
}

/**
 * Create the loginAction step.
 * @param config - Bank's login config.
 * @returns Pipeline step: fill fields + click submit.
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
 * Wait for page URL to settle after form submit.
 * @param page - Browser page.
 * @returns True after wait completes.
 */
async function waitAfterSubmit(page: Page): Promise<boolean> {
  try {
    await page.waitForURL('**', { timeout: 15000, waitUntil: 'commit' });
  } catch {
    // Navigation may already have happened
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
 * Test a single result condition against URL/page.
 * @param condition - String, RegExp, or async function.
 * @param url - Current page URL.
 * @param page - Browser page (for function conditions).
 * @returns True if condition matches.
 */
async function testCondition(
  condition: ResultCondition,
  url: string,
  page: Page,
): Promise<boolean> {
  if (typeof condition === 'string') {
    const urlLower = url.toLowerCase();
    const condLower = condition.toLowerCase();
    return urlLower.includes(condLower);
  }
  if (condition instanceof RegExp) return condition.test(url);
  const isMatch = condition({ page });
  return isMatch;
}

/**
 * Check a list of conditions sequentially, returning true on first match.
 * @param conditions - Array of result conditions to test.
 * @param url - Current page URL.
 * @param page - Browser page.
 * @returns True if any condition matches.
 */
async function checkConditions(
  conditions: readonly ResultCondition[],
  url: string,
  page: Page,
): Promise<boolean> {
  const initial = Promise.resolve(false);
  return conditions.reduce<Promise<boolean>>(async (prev, cond) => {
    if (await prev) return true;
    return testCondition(cond, url, page);
  }, initial);
}

/**
 * Check possibleResults against current page state.
 * @param page - Browser page.
 * @param config - Login config with possibleResults.
 * @returns Procedure — success or specific error type.
 */
async function checkResult(page: Page, config: ILoginConfig): Promise<Procedure<boolean>> {
  const url = page.url();
  const { invalidPassword = [], changePassword = [] } = config.possibleResults;
  if (await checkConditions(invalidPassword, url, page)) {
    return fail(ScraperErrorTypes.InvalidPassword, `Login failed: ${url}`);
  }
  if (await checkConditions(changePassword, url, page)) {
    return fail(ScraperErrorTypes.ChangePassword, `Password change required: ${url}`);
  }
  return succeed(true);
}

/**
 * Execute the postLogin step body.
 * @param config - Bank's login config.
 * @param input - Context from loginAction.
 * @returns Success or login error.
 */
async function executePostLogin(
  config: ILoginConfig,
  input: IPipelineContext,
): Promise<Procedure<IPipelineContext>> {
  if (!input.browser.has) return fail(ScraperErrorTypes.Generic, 'No browser for postLogin');
  const page = input.browser.value.page;
  await waitAfterSubmit(page);
  const resultCheck = await checkResult(page, config);
  if (!resultCheck.ok) return resultCheck;
  await runPostAction(page, config);
  return succeed(input);
}

/**
 * Create the postLogin step.
 * @param config - Bank's login config.
 * @returns Pipeline step: wait + check result + postAction.
 */
function createPostLoginStep(
  config: ILoginConfig,
): IPipelineStep<IPipelineContext, IPipelineContext> {
  return {
    name: 'post-login',
    /**
     * Execute postLogin: wait for navigation, check result, run postAction.
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
