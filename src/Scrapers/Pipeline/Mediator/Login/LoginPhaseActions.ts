/**
 * LOGIN phase Mediator actions — PRE/ACTION/POST/FINAL.
 * Phase orchestrates ONLY. All logic here.
 *
 * PRE:    discover credential form (checkReadiness + preAction + field discovery)
 * ACTION: fill from discovery + submit (sealed IActionContext, no mediator)
 * POST:   validate OK or error (error discovery + traffic wait)
 * FINAL:  prove dashboard loaded → signal to DASHBOARD (cookie audit + API strategy)
 */

import type { Frame, Page } from 'playwright-core';

import type { SelectorCandidate } from '../../../Base/Config/LoginConfigTypes.js';
import { ScraperErrorTypes } from '../../../Base/ErrorTypes.js';
import type { IFieldConfig } from '../../../Base/Interfaces/Config/FieldConfig.js';
import type { ILoginConfig } from '../../../Base/Interfaces/Config/LoginConfig.js';
import { WK_LOGIN_FORM } from '../../Registry/WK/LoginWK.js';
import { toErrorMessage } from '../../Types/ErrorUtils.js';
import { maskVisibleText } from '../../Types/LogEvent.js';
import { none, type Option, some } from '../../Types/Option.js';
import {
  type IActionContext,
  type ILoginFieldDiscovery,
  type ILoginState,
  type IPipelineContext,
  type IResolvedTarget,
  LOGIN_FIELDS,
  type LoginFieldKey,
} from '../../Types/PipelineContext.js';
import type { Procedure } from '../../Types/Procedure.js';
import { fail, succeed } from '../../Types/Procedure.js';
import { waitForPostLoginTraffic } from '../Auth/PostLoginTrafficProbe.js';
import { computeContextId } from '../Elements/ActionExecutors.js';
import type { IElementMediator, IRaceResult } from '../Elements/ElementMediator.js';
import type { IFormAnchor } from '../Form/FormAnchor.js';
import { fillFromDiscovery } from '../Form/LoginFormActions.js';
import { passwordFirst } from '../Form/LoginScopeResolver.js';
import { runPostCallback } from '../Form/PostActionResolver.js';
import { waitUntil } from '../Timing/Waiting.js';

/** Timeout for post-login redirect settle. */
const REDIRECT_SETTLE_MS = 15000;

/**
 * Run checkReadiness if configured — returns failure Procedure or false.
 * @param config - Login config.
 * @param page - Browser page.
 * @returns Failure Procedure on error, false on success/skip.
 */
async function runCheckReadiness(
  config: ILoginConfig,
  page: Page,
): Promise<Procedure<IPipelineContext> | false> {
  if (!config.checkReadiness) return false;
  try {
    await config.checkReadiness(page);
    return false;
  } catch (err) {
    const msg = toErrorMessage(err as Error);
    return fail(ScraperErrorTypes.Generic, `LOGIN PRE: checkReadiness — ${msg}`);
  }
}

/**
 * Run preAction if configured — returns the active frame.
 * @param config - Login config.
 * @param page - Browser page.
 * @returns Active frame (Page or Frame), or failure Procedure.
 */
async function runPreAction(config: ILoginConfig, page: Page): Promise<Procedure<Page | Frame>> {
  if (!config.preAction) return succeed(page as Page | Frame);
  try {
    const frame = await config.preAction(page);
    const activeFrame: Page | Frame = frame ?? page;
    return succeed(activeFrame);
  } catch (err) {
    const msg = toErrorMessage(err as Error);
    return fail(ScraperErrorTypes.Generic, `LOGIN PRE: preAction — ${msg}`);
  }
}

/** Bundled arguments for resolving one field in PRE. */
interface IResolveFieldArgs {
  readonly mediator: IElementMediator;
  readonly field: IFieldConfig;
  readonly activeFrame: Page | Frame;
  readonly page: Page;
  readonly logger: IPipelineContext['logger'];
}

/**
 * Resolve one credential field and build an IResolvedTarget.
 * @param args - Bundled resolve arguments.
 * @returns Resolved target or false if not found.
 */
async function resolveOneField(args: IResolveFieldArgs): Promise<IResolvedTarget | false> {
  const key = args.field.credentialKey;
  const msg = `PRE resolving ${maskVisibleText(key)}`;
  args.logger.debug({ message: msg });
  const result = await args.mediator.resolveField(key, args.field.selectors, args.activeFrame);
  if (!result.success) return false;
  const contextId = computeContextId(result.value.context, args.page);
  return {
    selector: result.value.selector,
    contextId,
    kind: result.value.resolvedKind ?? result.value.resolvedVia,
    candidateValue: key,
  };
}

/** Bundled args for accumulating one resolved field. */
interface IAccumulateArgs {
  readonly targets: Map<LoginFieldKey, IResolvedTarget>;
  readonly key: LoginFieldKey;
  readonly target: IResolvedTarget | false;
}

/** Lookup for field resolution trace labels. */
const FIELD_RESULT_TAG: Record<string, string> = { true: 'FOUND', false: 'NOT_FOUND' };

/**
 * Accumulate one resolved field into the targets map.
 * @param args - Bundled accumulate arguments.
 * @param logger - Pipeline logger.
 * @returns Updated targets map.
 */
function accumulateTarget(
  args: IAccumulateArgs,
  logger: IPipelineContext['logger'],
): Map<LoginFieldKey, IResolvedTarget> {
  const tag = FIELD_RESULT_TAG[String(!!args.target)];
  logger.debug({ field: maskVisibleText(args.key), result: tag });
  if (args.target) args.targets.set(args.key, args.target);
  return args.targets;
}

/** Bundled arguments for discovering all login fields. */
interface IDiscoverFieldsArgs {
  readonly mediator: IElementMediator;
  readonly config: ILoginConfig;
  readonly activeFrame: Page | Frame;
  readonly page: Page;
  readonly logger: IPipelineContext['logger'];
}

/** Accumulator for field discovery reduce. */
interface IFieldAccum {
  readonly targets: Map<LoginFieldKey, IResolvedTarget>;
  readonly formAnchor: Option<IFormAnchor>;
}

/**
 * Resolve one field and accumulate into the discovery state.
 * @param args - Discovery arguments.
 * @param accum - Running accumulator.
 * @param field - Field to resolve.
 * @returns Updated accumulator.
 */
async function resolveAndAccumulate(
  args: IDiscoverFieldsArgs,
  accum: IFieldAccum,
  field: IFieldConfig,
): Promise<IFieldAccum> {
  const resolved = await resolveOneField({
    mediator: args.mediator,
    field,
    activeFrame: args.activeFrame,
    page: args.page,
    logger: args.logger,
  });
  const key = field.credentialKey as LoginFieldKey;
  accumulateTarget({ targets: accum.targets, key, target: resolved }, args.logger);
  if (!resolved) return accum;
  if (accum.formAnchor.has) return accum;
  const anchor = await discoverFormFromField(args, field);
  return { targets: accum.targets, formAnchor: anchor };
}

/**
 * Discover all login fields via mediator and build ILoginFieldDiscovery.
 * Password resolves first (universal anchor), then others scope from it.
 * @param args - Bundled discovery arguments.
 * @returns Fully populated login field discovery.
 */
async function executeDiscoverFields(args: IDiscoverFieldsArgs): Promise<ILoginFieldDiscovery> {
  const ordered = passwordFirst(args.config.fields);
  const seed: IFieldAccum = { targets: new Map(), formAnchor: none() };
  const seedPromise = Promise.resolve(seed);
  const final = await ordered.reduce(
    (acc, field) => acc.then(a => resolveAndAccumulate(args, a, field)),
    seedPromise,
  );
  const fallbackFrameId = computeContextId(args.activeFrame, args.page);
  const passwordTarget = final.targets.get('password');
  const activeFrameId = passwordTarget?.contextId ?? fallbackFrameId;
  const submitTarget = await resolveSubmitTarget(args, final.formAnchor, activeFrameId);
  return { targets: final.targets, formAnchor: final.formAnchor, activeFrameId, submitTarget };
}

/**
 * Discover form anchor from the first successfully resolved field.
 * @param args - Discovery arguments.
 * @param field - The field that was just resolved.
 * @returns Option wrapping the form anchor.
 */
async function discoverFormFromField(
  args: IDiscoverFieldsArgs,
  field: IFieldConfig,
): Promise<Option<IFormAnchor>> {
  const fieldCtx = await args.mediator.resolveField(
    field.credentialKey,
    field.selectors,
    args.activeFrame,
  );
  if (!fieldCtx.success) return none();
  return args.mediator.discoverForm(fieldCtx.value);
}

/**
 * Normalize submit config to flat array of SelectorCandidate.
 * @param submit - Single or array of candidates.
 * @returns Flat array of candidates.
 */
function normalizeSubmitConfig(submit: ILoginConfig['submit']): readonly SelectorCandidate[] {
  if (Array.isArray(submit) && submit.length > 0) return submit;
  if (!Array.isArray(submit)) return [submit];
  return WK_LOGIN_FORM.submit;
}

/** Trustworthy form-anchor selector (id/name/class) or empty string sentinel. */
type FormAnchorSelector = string;

/**
 * Extract form-anchor selector ONLY when the anchor is trustworthy:
 *   - `#id`             (e.g. Amex/Isracard `#otpLobbyFormPassword`)
 *   - `tag[name="X"]`   (form name attribute when id is empty)
 *   - `tag.class`       (e.g. Max `form.user-login-form` when id+name empty)
 * Positional fallbacks (`tag:nth-of-type(N)`) and bare `tag` are REJECTED
 * — they're either fragile (`div:nth-of-type(0)` Discount trap) or too
 * broad (matches every form on the page). For untrustworthy anchors,
 * return empty so the caller falls back to page-wide search.
 * @param formAnchor - Optional form anchor option.
 * @returns Trustworthy CSS selector or empty string.
 */
function extractFormAnchorSelector(formAnchor: Option<IFormAnchor>): FormAnchorSelector {
  if (!formAnchor.has) return '';
  const selector = formAnchor.value.selector;
  if (selector.length === 0) return '';
  // Accept id-based: starts with `#` followed by a non-empty id.
  if (selector.startsWith('#') && selector.length > 1) return selector;
  // Accept attribute-based: contains `[name="..."]`.
  if (selector.includes('[name="')) return selector;
  // Accept class-based: contains `.<class>` after the tag (e.g. `form.user-login-form`).
  if (/^[a-z]+\.[a-zA-Z][\w-]*$/.test(selector)) return selector;
  // Reject everything else (positional `:nth-of-type`, bare `form`, etc.).
  return '';
}

/** Candidate value fallbacks for submit resolution. */
const SUBMIT_FALLBACKS: Record<string, string> = { true: '', false: 'submit' };

/**
 * Extract candidate value from race result.
 * @param result - Race result from resolveVisible.
 * @returns Candidate value string.
 */
function extractCandidateVal(result: IRaceResult): string {
  if (!result.candidate) return SUBMIT_FALLBACKS.false;
  return result.candidate.value;
}

/**
 * Extract candidate kind from race result.
 * @param result - Race result from resolveVisible.
 * @returns Candidate kind string.
 */
function extractCandidateKind(result: IRaceResult): string {
  if (!result.candidate) return 'unknown';
  return result.candidate.kind;
}

/**
 * Resolve the submit button — ONE form, ONE button.
 * Step 1: Find button[type="submit"] in the SAME frame as password (structural).
 * Step 2: If none, try WK text candidates scoped to form anchor + same frame.
 * Rejects ANY button outside the password's frame.
 * @param args - Discovery arguments.
 * @param formAnchor - Discovered form anchor.
 * @param activeFrameId - Frame where password was found — submit must be here.
 * @returns Option wrapping the resolved submit target.
 */
async function resolveSubmitTarget(
  args: IDiscoverFieldsArgs,
  formAnchor: Option<IFormAnchor>,
  activeFrameId: string,
): Promise<Option<IResolvedTarget>> {
  // Form-membership via Playwright Locator chaining — the form anchor selector
  // is passed through to mediator.resolveVisible, which scopes ALL candidate
  // kinds (xpath, textContent, regex, ariaLabel, ...) to descendants of the
  // matched form. Discriminates co-resident submit buttons on flip-card pages.
  const anchorSelector = extractFormAnchorSelector(formAnchor);
  const structuralWk = WK_LOGIN_FORM.submitStructural as unknown as readonly SelectorCandidate[];
  const structural = await resolveInFrame({
    args,
    candidates: structuralWk,
    requiredFrameId: activeFrameId,
    formAnchor: anchorSelector,
  });
  if (structural.has) return structural;
  const raw = normalizeSubmitConfig(args.config.submit);
  return resolveInFrame({
    args,
    candidates: raw,
    requiredFrameId: activeFrameId,
    formAnchor: anchorSelector,
  });
}

/** Bundled args for resolveInFrame — keeps the function inside the 3-param ceiling. */
interface IResolveInFrameArgs {
  readonly args: IDiscoverFieldsArgs;
  readonly candidates: readonly SelectorCandidate[];
  readonly requiredFrameId: string;
  readonly formAnchor: string;
}

/**
 * Resolve a visible element strictly within a specific frame.
 * @param input - Bundled discovery args + candidates + frame + formAnchor.
 *   `formAnchor` is passed through to `mediator.resolveVisible` so Locator
 *   chaining applies form scoping uniformly to ALL candidate kinds.
 * @returns Resolved target in the correct frame, or none.
 */
async function resolveInFrame(input: IResolveInFrameArgs): Promise<Option<IResolvedTarget>> {
  const args = input.args;
  const requiredFrameId = input.requiredFrameId;
  const result = await args.mediator.resolveVisible(input.candidates, undefined, input.formAnchor);
  if (!result.found || !result.context) return none();
  const contextId = computeContextId(result.context, args.page);
  const candidateVal = extractCandidateVal(result);
  const kind = extractCandidateKind(result);
  if (contextId !== requiredFrameId) {
    args.logger.debug({
      field: 'submit',
      result: 'WRONG_FRAME',
      message: `"${candidateVal}" in ${contextId}, expected ${requiredFrameId}`,
    });
    return none();
  }
  args.logger.debug({
    field: 'submit',
    result: 'FOUND',
    message: `"${candidateVal}" kind=${kind} frame=${contextId}`,
  });
  const selector = buildSubmitSelector(result, input.formAnchor);
  return some({ selector, contextId, kind, candidateValue: candidateVal });
}

/**
 * Build the inner (un-scoped) selector for a candidate kind.
 * @param result - Race result from resolveVisible.
 * @returns Inner selector string without form scope.
 */
function buildInnerSubmitSelector(result: IRaceResult): string {
  if (!result.candidate) return 'button[type="submit"]';
  const c = result.candidate;
  // ariaLabel kind matches by accessible name, not the [aria-label] attribute.
  // PRE uses `getByRole('button', { name })`; click-time storage must use the
  // role engine to agree. Max's user-login-form button derives its name from
  // an inner <span> and has no aria-label attr — `[aria-label="..."]` would
  // match 0 elements and the click would silently no-op.
  const selectorMap: Record<string, string> = {
    xpath: c.value,
    textContent: `text=${c.value}`,
    exactText: `text="${c.value}"`,
    placeholder: `[placeholder="${c.value}"]`,
    ariaLabel: `role=button[name="${c.value}"]`,
    labelText: `text=${c.value}`,
  };
  return selectorMap[c.kind] ?? c.value;
}

/**
 * Build a scoped selector from the resolved submit race result. When a
 * trustworthy form anchor (id-based, validated by `extractFormAnchorSelector`)
 * exists, the stored selector uses Playwright's `>>` chain syntax so the
 * click executor's `frame.locator(selector).click()` resolves to descendants
 * of the form — unambiguous click target on flip-card pages where multiple
 * `<button type="submit">` exist page-wide (Amex/Isracard).
 *
 * Without form scoping, `frame.locator('//button[@type="submit"]')` matches
 * every submit button on the page → multi-match strict violation → click
 * fails silently → no transition. The form-scoped chain narrows to one match
 * (the password-form's submit button), so the click lands correctly.
 *
 * The form anchor is only applied when `extractFormAnchorSelector` returns
 * non-empty (id-based anchors only — positional fallbacks are dropped to
 * preserve safe behavior on banks like Discount with empty-id forms).
 * @param result - Race result from resolveVisible.
 * @param formAnchor - Trustworthy form selector or empty string.
 * @returns Scoped selector string for the click executor.
 */
function buildSubmitSelector(result: IRaceResult, formAnchor: string): string {
  const inner = buildInnerSubmitSelector(result);
  if (formAnchor.length === 0) return inner;
  return `${formAnchor} >> ${inner}`;
}

/**
 * PRE: Discover credential form — run checkReadiness + preAction + field discovery.
 * Sets login.activeFrame AND loginFieldDiscovery for ACTION.
 * @param config - Login config.
 * @param input - Pipeline context with browser.
 * @returns Updated context with login state and field discovery.
 */
async function executeDiscoverForm(
  config: ILoginConfig,
  input: IPipelineContext,
): Promise<Procedure<IPipelineContext>> {
  if (!input.browser.has) return fail(ScraperErrorTypes.Generic, 'LOGIN PRE: no browser');
  if (!input.mediator.has) return fail(ScraperErrorTypes.Generic, 'LOGIN PRE: no mediator');
  const page = input.browser.value.page;
  const readyCheck = await runCheckReadiness(config, page);
  if (readyCheck) return readyCheck;
  const frameResult = await runPreAction(config, page);
  if (!frameResult.success) return frameResult;
  const activeFrame = frameResult.value;
  const loginState: ILoginState = { activeFrame, persistentOtpToken: none() };
  input.logger.debug({
    message: maskVisibleText(`activeFrame=${activeFrame.url()}`),
  });
  const discovery = await executeDiscoverFields({
    mediator: input.mediator.value,
    config,
    activeFrame,
    page,
    logger: input.logger,
  });
  return succeed({
    ...input,
    login: some(loginState),
    loginFieldDiscovery: some(discovery),
  });
}

/**
 * ACTION: Fill fields from PRE discovery + submit via sealed executor.
 * Pure IActionContext — no bridge cast, no mediator, no raw Page.
 * @param config - Login config with submit candidates.
 * @param input - Sealed action context with discovery + executor.
 * @returns Updated context with submitMethod in diagnostics.
 */
async function executeFillAndSubmitFromDiscovery(
  config: ILoginConfig,
  input: IActionContext,
): Promise<Procedure<IActionContext>> {
  if (!input.loginFieldDiscovery.has) {
    return fail(ScraperErrorTypes.Generic, 'LOGIN ACTION: no field discovery');
  }
  if (!input.executor.has) return fail(ScraperErrorTypes.Generic, 'LOGIN ACTION: no executor');
  const creds = input.credentials as Record<string, string>;
  const result = await fillFromDiscovery({
    discovery: input.loginFieldDiscovery.value,
    executor: input.executor.value,
    config,
    creds,
    logger: input.logger,
  });
  if (!result.success) return result;
  const diag = { ...input.diagnostics, submitMethod: result.value.method };
  return succeed({ ...input, diagnostics: diag });
}

/** Minimal error-scan result shape for the all-frames helper. */
interface IFramesScanResult {
  readonly hasErrors: boolean;
  readonly summary: string;
}

/** Empty scan sentinel for the all-frames helper. */
const FRAMES_NO_ERRORS: IFramesScanResult = { hasErrors: false, summary: '' };

/**
 * Per-frame wall-clock budget for discoverErrors. Frames that do not
 * resolve within this budget (detached, cross-origin loading, stuck
 * script) are treated as clean so the Promise.all fan-out does not
 * block the entire login validation indefinitely.
 *
 * 3000ms matches the typical per-frame DOM scan latency on the slowest
 * SPA banks (cal-online, max) plus a 2x safety margin.
 */
const PER_FRAME_SCAN_TIMEOUT_MS = 3000;

/**
 * Produce a Promise that resolves to FRAMES_NO_ERRORS after ms elapses.
 * @param ms - Budget in milliseconds.
 * @returns Empty-scan Promise.
 */
async function budgetFrameScan(ms: number): Promise<IFramesScanResult> {
  const { setTimeout: setTimeoutPromise } = await import('node:timers/promises');
  await setTimeoutPromise(ms, undefined, { ref: false });
  return FRAMES_NO_ERRORS;
}

/**
 * Scan a single frame, swallowing detached-frame errors AND capping the
 * call at PER_FRAME_SCAN_TIMEOUT_MS so one hung frame cannot stall the
 * Promise.all fan-out across the whole frame tree.
 * @param mediator - Element mediator.
 * @param frame - Page or iframe to scan.
 * @returns Scan result (empty on failure or timeout).
 */
async function safeScanFrame(
  mediator: IElementMediator,
  frame: Page | Frame,
): Promise<IFramesScanResult> {
  const discover = mediator.discoverErrors(frame).catch((): IFramesScanResult => FRAMES_NO_ERRORS);
  const budget = budgetFrameScan(PER_FRAME_SCAN_TIMEOUT_MS);
  const scan = await Promise.race([discover, budget]);
  if (!scan.hasErrors) return FRAMES_NO_ERRORS;
  return { hasErrors: true, summary: scan.summary };
}

/**
 * Scan the main page AND every child iframe for error markers in
 * parallel. Banks like VisaCal render their login form inside a deep
 * iframe tree, so the activeFrame-only scan misses their mat-error
 * banners. Returns the first frame's error scan that has errors, or
 * FRAMES_NO_ERRORS.
 * @param mediator - Element mediator (exposes discoverErrors).
 * @param page - Playwright page.
 * @returns Scan result — first frame with errors wins.
 */
async function discoverErrorsAllFrames(
  mediator: IElementMediator,
  page: Page,
): Promise<IFramesScanResult> {
  const childFrames = page.frames();
  const frames: readonly (Page | Frame)[] = [page, ...childFrames];
  const scanPromises = frames.map(
    (frame): Promise<IFramesScanResult> => safeScanFrame(mediator, frame),
  );
  const scans = await Promise.all(scanPromises);
  const hit = scans.find((scan): boolean => scan.hasErrors);
  return hit ?? FRAMES_NO_ERRORS;
}

/**
 * Probe the generic auth-failure watcher and convert any captured failure
 * into a Procedure. Returns false when the watcher has not (yet) fired
 * so the caller can fall through to the legacy DOM/URL detectors.
 *
 * The watcher is attached when NetworkDiscovery is created, listens to
 * every page response, and short-circuits the moment a WK auth endpoint
 * either returns 4xx (Layer 1) or 200 with a body matching the shared
 * AUTH_BODY_FAILURE_PATTERNS table (Layer 2). Generic across all banks —
 * NO per-bank knowledge here.
 * @param mediator - Element mediator (exposes networkDiscovery).
 * @returns Failure procedure when the watcher fired, false otherwise.
 */
/** Lookup table mapping classifier → human-readable layer label. */
const AUTH_FAILURE_LAYER_LABELS: Record<string, string> = {
  'http-4xx': 'HTTP 4xx',
  'body-error': 'body-error',
};

/**
 * Probe the generic auth-failure watcher (`mediator.network.authFailureWatcher`)
 * and convert any captured failure into a fail Procedure. Returns false
 * when the watcher has not (yet) fired, so the caller can fall through
 * to the legacy DOM/URL detectors.
 * @param mediator - Element mediator (exposes networkDiscovery).
 * @returns Failure procedure when the watcher fired, false otherwise.
 */
function detectAuthApiFailure(mediator: IElementMediator): Procedure<IPipelineContext> | false {
  const captured = mediator.network.authFailureWatcher.hasFailed();
  if (!captured) return false;
  const layerLabel = AUTH_FAILURE_LAYER_LABELS[captured.classifier] ?? captured.classifier;
  const summary = `Auth API ${layerLabel} (${String(captured.status)}): ${captured.bodyPreview}`;
  return fail(ScraperErrorTypes.InvalidPassword, summary);
}

/**
 * POST: Validate login — check for form errors, wait for SPA traffic.
 * @param config - Login config with postAction callback.
 * @param mediator - Element mediator.
 * @param input - Pipeline context with login state + browser.
 * @returns Succeed or fail with error type.
 */
async function executeValidateLogin(
  config: ILoginConfig,
  mediator: IElementMediator,
  input: IPipelineContext,
): Promise<Procedure<IPipelineContext>> {
  if (!input.login.has) return fail(ScraperErrorTypes.Generic, 'LOGIN POST: no login state');
  if (!input.browser.has) return fail(ScraperErrorTypes.Generic, 'LOGIN POST: no browser');
  const page = input.browser.value.page;
  const activeFrame = input.login.value.activeFrame;
  const loadingDone = await mediator.waitForLoadingDone(activeFrame);
  if (!loadingDone.success) return loadingDone;
  // Generic auth-API watcher — fast-path for any bank whose auth endpoint
  // already signalled failure (4xx or body-error) by the time the page
  // settled. Wins races against the slow URL/DOM detectors below for
  // SPA banks that never URL-redirect on rejected creds.
  const earlyAuthFail = detectAuthApiFailure(mediator);
  if (earlyAuthFail !== false) return earlyAuthFail;
  // Scan the main frame only — iframes on SPA banks (cal-online stack)
  // carry stale pre-submit validation placeholders that produce false
  // positives against valid credentials. Invalid-creds detection for
  // SPA banks falls through to detectLoginBounce below (URL pathname
  // stays on the login path after a rejected submit).
  const errors = await safeScanFrame(mediator, page);
  if (errors.hasErrors) {
    return fail(ScraperErrorTypes.InvalidPassword, `Form: ${errors.summary}`);
  }
  await waitForPostLoginTraffic(mediator, input.logger);
  const cbResult = await runPostCallback(page, config, input);
  if (!cbResult.success) return cbResult;
  await ensureDashboardRedirect(mediator, input);
  // Late-fire path: SPA banks whose auth API returns AFTER the loading
  // gate (delayed XHR, retried challenge, late SPA hydration). Same
  // generic mechanism, second checkpoint.
  const lateAuthFail = detectAuthApiFailure(mediator);
  if (lateAuthFail !== false) return lateAuthFail;
  const asyncCheck = await detectAsyncLoginErrors(mediator, input);
  if (asyncCheck !== false) return asyncCheck;
  return runLatePostChecks(mediator, input);
}

/**
 * Runs the post-redirect failure detectors that depend on DOM state
 * (form-presence) or URL shape (bounce). Extracted from
 * {@link executeValidateLogin} to keep cyclomatic complexity inside
 * the project's per-function ceiling.
 *
 * <p>Order matters: form-presence is the most generic cross-bank
 * signal (all banks destroy their login form on success), so it runs
 * before the URL-bounce detector that has bank-specific path-shape
 * assumptions.
 *
 * @param mediator - Element mediator for DOM + URL probes.
 * @param input - Pipeline context.
 * @returns Failure procedure on detected failure, otherwise `succeed(input)`.
 */
async function runLatePostChecks(
  mediator: IElementMediator,
  input: IPipelineContext,
): Promise<Procedure<IPipelineContext>> {
  const formStillThere = await detectLoginFormStillPresent(mediator, input);
  if (formStillThere !== false) return formStillThere;
  const bounce = detectLoginBounce(mediator, input);
  if (bounce !== false) return bounce;
  return succeed(input);
}

/**
 * Re-scan the MAIN page for error banners that render asynchronously
 * AFTER the SPA finishes its post-submit redirect cycle (e.g. Discount's
 * "תהליך הזיהוי נכשל" banner). Iframes are deliberately excluded here
 * because SPA login iframes routinely carry stale pre-submit validation
 * placeholders (e.g. VisaCal's "שכחת להקליד" mat-errors on empty
 * fields) that fire false positives against valid-credential flows.
 * The initial (sync) scan at the top of executeValidateLogin still
 * covers iframes for invalid-creds detection.
 * @param mediator - Element mediator (for currentUrl + discoverErrors).
 * @param input - Pipeline context with browser + diagnostics.
 * @returns Failure procedure on detected async error, else false.
 */
async function detectAsyncLoginErrors(
  mediator: IElementMediator,
  input: IPipelineContext,
): Promise<Procedure<IPipelineContext> | false> {
  if (!hasStayedOnLoginUrl(mediator, input)) return false;
  if (!input.browser.has) return false;
  const page = input.browser.value.page;
  const asyncErrors = await safeScanFrame(mediator, page);
  if (!asyncErrors.hasErrors) return false;
  return fail(ScraperErrorTypes.InvalidPassword, `Form: ${asyncErrors.summary}`);
}

/**
 * Return true when the browser is still sitting on the original login
 * URL (no redirect happened). Used to decide whether the second
 * all-frames error scan is authoritative — after a successful
 * redirect, stale iframe validation placeholders would fire false
 * positives.
 * @param mediator - Element mediator (for currentUrl).
 * @param input - Pipeline context (for diagnostics.loginUrl).
 * @returns True when URL has not moved off the login path.
 */
function hasStayedOnLoginUrl(mediator: IElementMediator, input: IPipelineContext): boolean {
  const loginUrl = input.diagnostics.loginUrl;
  if (loginUrl.length === 0) return true;
  const currentUrl = mediator.getCurrentUrl();
  if (currentUrl === loginUrl) return true;
  if (currentUrl === `${loginUrl}#`) return true;
  const loginPath = loginPathOf(loginUrl);
  const currentPath = loginPathOf(currentUrl);
  return loginPath === currentPath;
}

/**
 * Normalise a URL to its pathname for path-equality comparison.
 * Returns the raw string on parse failure so the comparison still succeeds
 * when the current URL equals the login URL verbatim.
 * @param url - URL string.
 * @returns Pathname (no trailing slash unless root).
 */
/**
 * Parse a URL without throwing — returns false on malformed input.
 * @param url - URL string.
 * @returns Parsed URL or false.
 */
function safeParse(url: string): URL | false {
  try {
    return new URL(url);
  } catch {
    return false;
  }
}

/**
 * Extract the pathname of a URL, stripped of trailing slashes.
 * Falls back to the raw string when the URL cannot be parsed.
 * @param url - URL string.
 * @returns Pathname (no trailing slash unless root).
 */
function loginPathOf(url: string): string {
  const parsed = safeParse(url);
  if (parsed === false) return url;
  // Bounded quantifier so the regex matcher cannot super-linearly
  // backtrack on adversarial input (`typescript:S5852`). Real URL paths
  // never carry hundreds of trailing slashes; 255 is a generous cap.
  const stripped = parsed.pathname.replace(/\/{1,255}$/, '');
  if (stripped.length > 0) return stripped;
  return '/';
}

/** Maximum wall-clock budget for the form-presence poll. */
const FORM_PRESENCE_POLL_BUDGET_MS = 5000;
/** Per-tick interval for the form-presence poll. */
const FORM_PRESENCE_POLL_INTERVAL_MS = 500;

/**
 * Build the selector used to probe for the login form's password input.
 * <p>When PRE recorded a trustworthy form-anchor selector (id-based,
 * class-based, or `[name="…"]` — the same predicate `extractFormAnchorSelector`
 * uses for the submit button), chain it in front of the password
 * selector so the query matches only descendants of the original login
 * form. Without scoping, banks that recorded a generic xpath
 * (`//input[@type="password"]`) accidentally match the OTP step's
 * password input or any cached login DOM elsewhere on the page —
 * Isracard's regression in commit `d9636d8e`.
 * @param passwordSelector - Selector recorded by login.PRE.
 * @param formAnchor - Optional form anchor option from discovery.
 * @returns Scoped selector when anchor is trustworthy, else passthrough.
 */
function buildScopedFormPresenceSelector(
  passwordSelector: string,
  formAnchor: ILoginFieldDiscovery['formAnchor'],
): string {
  const anchorSelector = extractFormAnchorSelector(formAnchor);
  if (anchorSelector.length === 0) return passwordSelector;
  return `${anchorSelector} ${passwordSelector}`;
}

/**
 * Build the async predicate that the form-presence poll evaluates each
 * tick. The predicate resolves to `true` once the count drops to 0
 * (the login form has fully unmounted) and `false` while the form is
 * still in the DOM. `waitUntil` returns the first truthy value, so
 * returning `true` is what releases the poll.
 * @param mediator - Element mediator with `countBySelector`.
 * @param scopedSelector - Scoped or unscoped password selector.
 * @param logger - Pipeline logger for per-tick diagnostics.
 * @returns Async predicate suitable for `waitUntil`.
 */
function buildPollTick(
  mediator: IElementMediator,
  scopedSelector: string,
  logger: IPipelineContext['logger'],
): () => Promise<boolean> {
  const masked = maskVisibleText(scopedSelector);
  return async (): Promise<boolean> => {
    const stillPresent = await mediator.countBySelector(scopedSelector);
    logger.debug({
      message: `POST: form-presence tick — selector ${masked} count=${String(stillPresent)}`,
    });
    return stillPresent === 0;
  };
}

/**
 * Confirms the LOGIN ACTION did its job by checking the login form is
 * gone after the redirect.
 *
 * <p>A successful submit destroys the entire login form (the SPA renders
 * the next view — OTP step or dashboard); a rejected submit leaves the
 * form intact with the same password element the PRE stage resolved.
 * Probing for that exact element gives a generic, cross-bank failure
 * signal that doesn't depend on URL pathnames, error-text dictionaries,
 * or auth-API URL patterns.
 *
 * <p>Two compounding regressions were observed after the initial check
 * shipped in commit `d9636d8e`:
 *  - Generic password selectors (`xpath=//input[@type="password"]`)
 *    matched the OTP step's password input on banks like Isracard,
 *    producing a false-positive InvalidPassword on a successful login.
 *  - SPA frameworks (Angular/React) tear down the login view
 *    asynchronously after the URL flips. A 9 ms gap between redirect
 *    and a single-shot probe was not enough — the dying-frame login
 *    form was still mounted.
 *
 * <p>The fix scopes the probe to the trustworthy form anchor PRE
 * recorded (same predicate used to scope the submit click) AND polls
 * for up to {@link FORM_PRESENCE_POLL_BUDGET_MS} so the SPA has time
 * to finish its component teardown. A genuine invalid-credentials
 * path keeps the form mounted for the entire budget → loud
 * `fail(InvalidPassword)` — the same signal Hapoalim's gate test
 * relies on.
 *
 * @param mediator - Element mediator (for `countBySelector`).
 * @param input - Pipeline context carrying `loginFieldDiscovery` from PRE.
 * @returns Failure procedure when the login form persists, false otherwise.
 */
async function detectLoginFormStillPresent(
  mediator: IElementMediator,
  input: IPipelineContext,
): Promise<Procedure<IPipelineContext> | false> {
  if (!input.loginFieldDiscovery.has) return false;
  const discovery = input.loginFieldDiscovery.value;
  const passwordTarget = discovery.targets.get(LOGIN_FIELDS.PASSWORD);
  if (!passwordTarget) return false;
  const scopedSelector = buildScopedFormPresenceSelector(
    passwordTarget.selector,
    discovery.formAnchor,
  );
  const tick = buildPollTick(mediator, scopedSelector, input.logger);
  const isFormGone = await waitUntil(tick, 'login.POST form-presence poll', {
    timeout: FORM_PRESENCE_POLL_BUDGET_MS,
    interval: FORM_PRESENCE_POLL_INTERVAL_MS,
  })
    .then((): true => true)
    .catch((): false => false);
  if (isFormGone) return false;
  const masked = maskVisibleText(scopedSelector);
  const budgetMs = String(FORM_PRESENCE_POLL_BUDGET_MS);
  input.logger.debug({
    message: `POST: form still present after ${budgetMs}ms — ${masked}`,
  });
  return fail(
    ScraperErrorTypes.InvalidPassword,
    `LOGIN POST: form still present after ${budgetMs}ms — credentials likely invalid`,
  );
}

/**
 * Detects when the post-submit URL landed back on the login path with a
 * materially different URL — server bounced us (Max → `/login?ReturnURL=…`).
 * Skips when the URL is unchanged (Amex SPA login keeps the same href).
 * @param mediator - Element mediator for current URL.
 * @param input - Pipeline context with `diagnostics.loginUrl`.
 * @returns Failure procedure on bounce, false otherwise.
 */
function detectLoginBounce(
  mediator: IElementMediator,
  input: IPipelineContext,
): Procedure<IPipelineContext> | false {
  const loginUrl = input.diagnostics.loginUrl;
  if (loginUrl.length === 0) return false;
  const currentUrl = mediator.getCurrentUrl();
  if (currentUrl === loginUrl) return false;
  if (currentUrl === `${loginUrl}#`) return false;
  const loginPath = loginPathOf(loginUrl);
  const currentPath = loginPathOf(currentUrl);
  if (loginPath !== currentPath) return false;
  const masked = maskVisibleText(currentUrl);
  input.logger.debug({
    message: `POST: login bounce detected — still on ${loginPath} (url=${masked})`,
  });
  return fail(
    ScraperErrorTypes.InvalidPassword,
    `LOGIN POST: bounced back to login path ${loginPath}`,
  );
}

/**
 * Wait for post-login redirect to the authenticated dashboard.
 * After iframe login, the parent page auto-redirects. Just wait for it.
 * The wait is best-effort — a timeout does not fail the phase; POST's
 * subsequent traffic + URL gates make the actual decision.
 * @param mediator - Element mediator for URL access.
 * @param input - Pipeline context with browser + diagnostics.
 * @returns True when the redirect wait actually ran, false when the page
 * was already off the login URL or no browser was available (no-op skip).
 */
async function ensureDashboardRedirect(
  mediator: IElementMediator,
  input: IPipelineContext,
): Promise<boolean> {
  const currentUrl = mediator.getCurrentUrl();
  const loginUrl = input.diagnostics.loginUrl;
  const isStillOnLogin = currentUrl === loginUrl || currentUrl === `${loginUrl}#`;
  if (!isStillOnLogin) return false;
  if (!input.browser.has) return false;
  input.logger.debug({
    message: 'POST: waiting for dashboard redirect',
  });
  const page = input.browser.value.page;
  const loginHash = `${currentUrl}#`;
  await page
    .waitForURL((url: URL): boolean => url.href !== currentUrl && url.href !== loginHash, {
      timeout: REDIRECT_SETTLE_MS,
    })
    .catch((): false => false);
  const urlAfterWait = mediator.getCurrentUrl();
  input.logger.debug({
    message: `POST redirect → ${maskVisibleText(urlAfterWait)}`,
  });
  return true;
}

export { executeLoginSignal } from '../Auth/LoginSignalProbe.js';
export { executeDiscoverForm, executeFillAndSubmitFromDiscovery, executeValidateLogin };
// Internal helpers exposed only for focused unit tests. Do NOT import
// outside of src/Tests/Unit/**. Safe to change without deprecation.
export {
  detectAsyncLoginErrors,
  discoverErrorsAllFrames,
  extractFormAnchorSelector,
  hasStayedOnLoginUrl,
  safeScanFrame,
};
