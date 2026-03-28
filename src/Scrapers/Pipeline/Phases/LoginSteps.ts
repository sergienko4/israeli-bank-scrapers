/**
 * Login phase — preLogin/loginAction/postLogin. Generic for ALL banks.
 * ALL HTML resolution flows through ctx.mediator (Rule #10).
 */

import type { Frame, Page } from 'playwright-core';

import type { SelectorCandidate } from '../../Base/Config/LoginConfigTypes.js';
import { ScraperErrorTypes } from '../../Base/ErrorTypes.js';
import type { IFieldConfig } from '../../Base/Interfaces/Config/FieldConfig.js';
import type { ILoginConfig } from '../../Base/Interfaces/Config/LoginConfig.js';
import type { IElementMediator } from '../Mediator/ElementMediator.js';
import { toErrorMessage } from '../Types/ErrorUtils.js';
import { none, some } from '../Types/Option.js';
import type { IPipelineStep } from '../Types/Phase.js';
import type { IPipelineContext } from '../Types/PipelineContext.js';
import { hasPipelinePostAction } from '../Types/PipelineLoginConfig.js';
import type { Procedure } from '../Types/Procedure.js';
import { fail, succeed } from '../Types/Procedure.js';
import { deepFillInput } from './ElementsInteractions.js';

// ── Constants ─────────────────────────────────────────────

/** Timeout for post-login page settle (networkidle). */
const POST_LOGIN_SETTLE_TIMEOUT = 15000;

// ── Types ──────────────────────────────────────────────────

/** Credential field name key (e.g. 'username', 'password'). */
type FieldKey = string;
/** Raw credential value typed by the user. */
type CredentialValue = string;
/** CSS selector used to scope form resolution. */
type FormSelector = string;
/** Whether a fill operation succeeded. */
type FillSuccess = boolean;
/** Whether a required credential is absent from the map. */
type CredAbsent = boolean;

/** Options for filling a single credential field. */
export interface IFillOpts {
  readonly credentialKey: FieldKey;
  readonly value: CredentialValue;
  readonly selectors: readonly SelectorCandidate[];
}

// ── preLogin helpers ───────────────────────────────────────
/**
 * Run checkReadiness callback if provided.
 * @param config - Login config.
 * @param page - Browser page.
 * @returns Success or failure Procedure.
 */
async function runCheckReadiness(config: ILoginConfig, page: Page): Promise<Procedure<true>> {
  if (!config.checkReadiness) return succeed(true);
  try {
    await config.checkReadiness(page);
    return succeed(true);
  } catch (err) {
    return fail(ScraperErrorTypes.Generic, `checkReadiness: ${toErrorMessage(err as Error)}`);
  }
}

/**
 * Run preAction callback and return the active frame.
 * @param config - Login config.
 * @param page - Browser page.
 * @returns Frame returned by preAction, or page if none.
 */
async function runPreAction(config: ILoginConfig, page: Page): Promise<Procedure<Page | Frame>> {
  if (!config.preAction) return succeed(page as Page | Frame);
  try {
    const frame = await config.preAction(page);
    return succeed(frame ?? page);
  } catch (err) {
    return fail(ScraperErrorTypes.Generic, `preAction failed: ${toErrorMessage(err as Error)}`);
  }
}
/**
 * Execute the preLogin step body.
 * Calls checkReadiness (wait for login link) then preAction (open form/iframe).
 * The returned Frame (if any) becomes activeFrame for field scoping.
 * @param config - Bank's login config with optional lifecycle hooks.
 * @param input - Current pipeline context (page already on login URL).
 * @returns Updated context with login.activeFrame = frame or page.
 */
async function executePreLogin(
  config: ILoginConfig,
  input: IPipelineContext,
): Promise<Procedure<IPipelineContext>> {
  if (!input.browser.has) return fail(ScraperErrorTypes.Generic, 'No browser for preLogin');
  const page = input.browser.value.page;
  const readiness = await runCheckReadiness(config, page);
  if (!readiness.success) return readiness;
  const frameResult = await runPreAction(config, page);
  if (!frameResult.success) return frameResult;
  const loginState = { activeFrame: frameResult.value, persistentOtpToken: none() };
  return succeed({ ...input, login: some(loginState) });
}

/**
 * Create the preLogin step.
 * @param config - Bank's login config.
 * @returns Pipeline step: checkReadiness + preAction (open form) + set activeFrame.
 */
function createPreLoginStep(
  config: ILoginConfig,
): IPipelineStep<IPipelineContext, IPipelineContext> {
  return {
    name: 'pre-login',
    /**
     * Execute preLogin: call checkReadiness + preAction, set activeFrame.
     * @param _ - Unused pipeline context.
     * @param i - Context to extend with login.activeFrame.
     * @returns Updated context.
     */
    async execute(_: IPipelineContext, i: IPipelineContext): Promise<Procedure<IPipelineContext>> {
      return await executePreLogin(config, i);
    },
  };
}

// ── loginAction helpers ────────────────────────────────────

/** Result from filling one field — includes the resolved context for scoping. */
interface IFillResult {
  readonly isOk: FillSuccess;
  readonly procedure: Procedure<boolean>;
  readonly resolvedContext?: Page | Frame;
}

/** Bundled options for fillOneField — satisfies max-params. */
interface IFillFieldOpts {
  readonly mediator: IElementMediator;
  readonly fill: IFillOpts;
  readonly scopeContext?: Page | Frame;
  readonly formSelector?: FormSelector;
}

/**
 * Fill one credential field via mediator (black box — no direct HTML access).
 * @param opts - Bundled fill options with mediator, fill info, and scope.
 * @returns Fill result with resolved context for scoping subsequent fields.
 */
async function fillOneField(opts: IFillFieldOpts): Promise<IFillResult> {
  const result = await opts.mediator.resolveField(
    opts.fill.credentialKey,
    opts.fill.selectors,
    opts.scopeContext,
    opts.formSelector,
  );
  if (!result.success) return { isOk: false, procedure: result };
  await deepFillInput(result.value.context, result.value.selector, opts.fill.value);
  return { isOk: true, procedure: succeed(true), resolvedContext: result.value.context };
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
  /**
   * Check if a credential is missing from the provided map.
   * @param f - Field config to check.
   * @returns True if the credential value is empty or absent.
   */
  const isMissing = (f: IFieldConfig): CredAbsent => !creds[f.credentialKey];
  /**
   * Extract the credential key from a field config.
   * @param f - Field config.
   * @returns The credentialKey string.
   */
  const toKey = (f: IFieldConfig): FieldKey => f.credentialKey;
  const missing = fields.filter(isMissing).map(toKey);
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

/** Immutable scope state built up as fields are resolved. */
interface IFieldScope {
  readonly ctx?: Page | Frame;
  readonly formSelector?: FormSelector;
}

/** Accumulator for sequential field filling via reduce. */
interface IFillAccum {
  readonly scope: IFieldScope;
  readonly procedure: Procedure<boolean>;
}

/** Context for filling credential fields — bundled to satisfy max-params. */
interface IFillContext {
  readonly mediator: IElementMediator;
  readonly creds: Record<string, string>;
}

/**
 * Discover form anchor and return updated scope.
 * @param ctx - Fill context with mediator.
 * @param field - Field config that was just resolved.
 * @param scope - Current scope state.
 * @returns Updated scope with form selector.
 */
async function discoverScope(
  ctx: IFillContext,
  field: IFieldConfig,
  scope: IFieldScope,
): Promise<IFieldScope> {
  const reResolved = await ctx.mediator.resolveField(
    field.credentialKey,
    field.selectors,
    scope.ctx,
  );
  if (!reResolved.success) return scope;
  const anchor = await ctx.mediator.discoverForm(reResolved.value);
  if (!anchor.has) return scope;
  return { ...scope, formSelector: anchor.value.selector };
}

/**
 * Fill one field and update scope — single iteration step.
 * @param ctx - Fill context with mediator and credentials.
 * @param field - Field config to fill.
 * @param scope - Current scope state.
 * @returns Updated scope and procedure result.
 */
async function fillFieldStep(
  ctx: IFillContext,
  field: IFieldConfig,
  scope: IFieldScope,
): Promise<{ scope: IFieldScope; procedure: Procedure<boolean> }> {
  const fill = buildFillOpts(field, ctx.creds);
  const result = await fillOneField({
    mediator: ctx.mediator,
    fill,
    scopeContext: scope.ctx,
    formSelector: scope.formSelector,
  });
  if (!result.isOk) return { scope, procedure: result.procedure };
  let nextScope = scope;
  if (!scope.ctx && result.resolvedContext) {
    nextScope = { ...scope, ctx: result.resolvedContext };
    nextScope = await discoverScope(ctx, field, nextScope);
  }
  return { scope: nextScope, procedure: succeed(true) };
}

/**
 * Fill all credential fields sequentially via mediator.
 * Uses promise chain (not await-in-loop) for sequential field filling.
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
  if (!validation.success) return validation;
  const ctx: IFillContext = { mediator, creds };
  const initial: IFillAccum = { scope: {}, procedure: succeed(true) };
  const seed = Promise.resolve(initial);
  const final = await fields.reduce(
    async (prev: Promise<IFillAccum>, field): Promise<IFillAccum> => {
      const acc = await prev;
      if (!acc.procedure.success) return acc;
      return fillFieldStep(ctx, field, acc.scope);
    },
    seed,
  );
  return final.procedure;
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
  if (!result.success) return result;
  const locator = result.value.context.locator(result.value.selector);
  const btn = locator.first();
  try {
    await btn.click();
  } catch (err) {
    return fail(ScraperErrorTypes.Generic, `Submit click failed: ${toErrorMessage(err as Error)}`);
  }
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
  // Phase-Gate: FindLoginArea.POST must set loginAreaReady=true before any fill.
  if (!input.loginAreaReady) return fail(ScraperErrorTypes.Generic, 'gate: loginAreaReady=false');
  if (!input.login.has) return fail(ScraperErrorTypes.Generic, 'No login context from preLogin');
  if (!input.mediator.has) return fail(ScraperErrorTypes.Generic, 'No mediator in context');
  const mediator = input.mediator.value;
  const creds = input.credentials as Record<string, string>;
  const fillResult = await fillAllFields(mediator, config.fields, creds);
  if (!fillResult.success) return fillResult;
  const submitCandidates = normalizeSubmit(config.submit);
  const clickResult = await clickSubmit(mediator, submitCandidates);
  if (!clickResult.success) return clickResult;
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
  const step: IPipelineStep<IPipelineContext, IPipelineContext> = {
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
      return await executeLoginAction(config, input);
    },
  };
  return step;
}

// ── postLogin helpers ──────────────────────────────────────

/**
 * Wait for the page to reach networkidle after form submission.
 * Uses networkidle instead of waitForURL('**') to avoid SPA hash-routing false positives
 * (Angular/React apps already have a '#' URL before the form is submitted).
 * @param mediator - Element mediator with waitForNetworkIdle.
 * @returns Succeed after settling or timeout (timeout is non-fatal for SPAs).
 */
export async function waitForSubmitToSettle(mediator: IElementMediator): Promise<Procedure<void>> {
  return mediator.waitForNetworkIdle(POST_LOGIN_SETTLE_TIMEOUT);
}

/**
 * Execute a postAction callback safely, converting exceptions to Procedure failure.
 * @param action - The async callback to execute.
 * @returns Succeed or failure Procedure.
 */
async function safePostAction(action: () => Promise<void>): Promise<Procedure<void>> {
  try {
    await action();
    return succeed(undefined);
  } catch (err) {
    return fail(ScraperErrorTypes.Generic, `Post-login: ${toErrorMessage(err as Error)}`);
  }
}

/**
 * Run postAction callback if provided.
 * @param page - Browser page.
 * @param config - Login config.
 * @param ctx - Pipeline context.
 * @returns Success or failure Procedure.
 */
async function runPostAction(
  page: Page,
  config: ILoginConfig,
  ctx: IPipelineContext,
): Promise<Procedure<void>> {
  const hasPipelineCtx = hasPipelinePostAction(config);
  const ctxFn = hasPipelineCtx && config.postActionWithCtx;
  if (ctxFn)
    return safePostAction(async (): Promise<void> => {
      await ctxFn(page, ctx);
    });
  if (!config.postAction) return succeed(undefined);
  const postFn = config.postAction;
  return safePostAction(async (): Promise<void> => {
    await postFn(page);
  });
}

/**
 * Execute the postLogin step body.
 * Validates: form errors → network settle. Dashboard detection is in DASHBOARD phase.
 * @param config - Bank's login config.
 * @param input - Context from loginAction.
 * @returns Success or login error with specific errorType.
 */
/**
 * Execute the postLogin step body.
 * Validates: form errors → network settle. Dashboard detection is in DASHBOARD phase.
 * @param config - Bank's login config.
 * @param input - Context from loginAction.
 * @returns Success or login error with specific errorType.
 */
async function executePostLogin(
  config: ILoginConfig,
  input: IPipelineContext,
): Promise<Procedure<IPipelineContext>> {
  if (!input.browser.has) return fail(ScraperErrorTypes.Generic, 'No browser for postLogin');
  if (!input.login.has) return fail(ScraperErrorTypes.Generic, 'No login state for postLogin');
  if (!input.mediator.has) return fail(ScraperErrorTypes.Generic, 'No mediator for postLogin');
  const { page } = input.browser.value;
  const { activeFrame } = input.login.value;
  const mediator = input.mediator.value;
  const loadingDone = await mediator.waitForLoadingDone(activeFrame);
  if (!loadingDone.success) return loadingDone;
  const errors = await mediator.discoverErrors(activeFrame);
  if (errors.hasErrors) return fail(ScraperErrorTypes.InvalidPassword, `Form: ${errors.summary}`);
  await waitForSubmitToSettle(mediator);
  const postResult = await runPostAction(page, config, input);
  if (!postResult.success) return postResult;
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
  const step: IPipelineStep<IPipelineContext, IPipelineContext> = {
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
      return await executePostLogin(config, input);
    },
  };
  return step;
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
  const phase: ILoginPhase = {
    pre: createPreLoginStep(config),
    action: createLoginActionStep(config),
    post: createPostLoginStep(config),
  };
  return phase;
}

export { createLoginActionStep, createLoginPhase, createPostLoginStep, createPreLoginStep };
