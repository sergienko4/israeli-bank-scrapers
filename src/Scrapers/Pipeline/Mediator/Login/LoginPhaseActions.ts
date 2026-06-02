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
import type { IProcedureFailure, Procedure } from '../../Types/Procedure.js';
import { fail, succeed } from '../../Types/Procedure.js';
import { computeContextId } from '../Elements/ActionExecutors.js';
import type {
  IActionMediator,
  IElementMediator,
  IRaceResult,
} from '../Elements/ElementMediator.js';
import type { IPreludeSpec } from '../Elements/PagePrelude.js';
import { awaitFramePrelude, probeFirefoxNeterror } from '../Elements/PagePrelude.js';
import type { IFormAnchor } from '../Form/FormAnchor.js';
import { fillFromDiscovery } from '../Form/LoginFormActions.js';
import { passwordFirst } from '../Form/LoginScopeResolver.js';
import { detectOtpForm, detectOtpTrigger } from '../Form/OtpProbe.js';
import { runPostCallback } from '../Form/PostActionResolver.js';
import type { IFieldContext } from '../Selector/SelectorResolverPipeline.js';
import {
  ELEMENTS_DOM_READY_TIMEOUT_MS,
  LOGIN_PER_FRAME_SCAN_TIMEOUT_MS,
} from '../Timing/TimingConfig.js';
import { waitForPostLoginTraffic } from './PostLoginTrafficProbe.js';

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
  } catch (error) {
    const msg = toErrorMessage(error as Error);
    return fail(ScraperErrorTypes.Generic, `LOGIN PRE: checkReadiness — ${msg}`);
  }
}

/**
 * Invoke the optional preAction callback and select the active frame —
 * pulled out of {@link runPreAction} so the try-arm holds a single
 * statement and the surrounding fn stays inside the 10-LoC ceiling.
 *
 * @param preAction - Verified-present preAction callback.
 * @param page - Browser page.
 * @returns Active frame (Page or Frame) — the callback's return when
 *   defined, otherwise the page itself.
 */
async function performPreAction(
  preAction: NonNullable<ILoginConfig['preAction']>,
  page: Page,
): Promise<Page | Frame> {
  const frame = await preAction(page);
  return frame ?? page;
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
    const activeFrame = await performPreAction(config.preAction, page);
    return succeed(activeFrame);
  } catch (error) {
    const msg = toErrorMessage(error as Error);
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
 * Assemble an {@link IResolvedTarget} from a resolved {@link IFieldContext}.
 * Pure builder pulled out of {@link resolveOneField} so the caller
 * stays inside the 10-LoC ceiling.
 *
 * @param value - Successful field-resolver value.
 * @param page - Browser page (for frame-id derivation).
 * @param key - Original credential key recorded as `candidateValue`.
 * @returns Fully populated resolved target.
 */
function buildPreTarget(value: IFieldContext, page: Page, key: string): IResolvedTarget {
  return {
    selector: value.selector,
    contextId: computeContextId(value.context, page),
    kind: value.resolvedKind ?? value.resolvedVia,
    candidateValue: key,
  };
}

/**
 * Resolve one credential field and build an IResolvedTarget.
 * @param args - Bundled resolve arguments.
 * @returns Resolved target or false if not found.
 */
async function resolveOneField(args: IResolveFieldArgs): Promise<IResolvedTarget | false> {
  const key = args.field.credentialKey;
  args.logger.debug({ message: `PRE resolving ${maskVisibleText(key)}` });
  const result = await args.mediator.resolveField(key, args.field.selectors, args.activeFrame);
  if (!result.success) return false;
  return buildPreTarget(result.value, args.page, key);
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
 * Resolve one field via {@link resolveOneField} using the bundle
 * fields of {@link IDiscoverFieldsArgs}. Forwards args without the
 * field-discovery caller having to re-build the bundle inline.
 *
 * @param args - Discovery arguments bundle.
 * @param field - Field config to resolve.
 * @returns Resolved target or false when the field is not found.
 */
async function resolveFieldInDiscovery(
  args: IDiscoverFieldsArgs,
  field: IFieldConfig,
): Promise<IResolvedTarget | false> {
  return resolveOneField({
    mediator: args.mediator,
    field,
    activeFrame: args.activeFrame,
    page: args.page,
    logger: args.logger,
  });
}

/** Args bundle for {@link maybeDiscoverAnchor} — under the 3-param ceiling. */
interface IAnchorCheckArgs {
  readonly accum: IFieldAccum;
  readonly field: IFieldConfig;
  readonly resolved: IResolvedTarget | false;
}

/**
 * Discover a form anchor lazily — only when the field resolved AND
 * no anchor has been captured yet. Returns the existing anchor in
 * both other branches so the caller does not have to fork on tags.
 *
 * @param args - Discovery arguments bundle.
 * @param check - Anchor-check bundle (accum + field + resolved).
 * @returns Form-anchor option (existing or newly discovered).
 */
async function maybeDiscoverAnchor(
  args: IDiscoverFieldsArgs,
  check: IAnchorCheckArgs,
): Promise<Option<IFormAnchor>> {
  if (!check.resolved) return check.accum.formAnchor;
  if (check.accum.formAnchor.has) return check.accum.formAnchor;
  return discoverFormFromField(args, check.field);
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
  const resolved = await resolveFieldInDiscovery(args, field);
  const key = field.credentialKey as LoginFieldKey;
  accumulateTarget({ targets: accum.targets, key, target: resolved }, args.logger);
  const formAnchor = await maybeDiscoverAnchor(args, { accum, field, resolved });
  return { targets: accum.targets, formAnchor };
}

/**
 * Fold the ordered field list into a {@link IFieldAccum}, sequentially
 * resolving and accumulating each field. Sequential — later fields
 * scope from the first resolved field's frame.
 *
 * @param args - Discovery arguments bundle.
 * @param ordered - Fields in password-first iteration order.
 * @returns Accumulator after every field has been processed.
 */
async function foldDiscoveryFields(
  args: IDiscoverFieldsArgs,
  ordered: readonly IFieldConfig[],
): Promise<IFieldAccum> {
  const seed: IFieldAccum = { targets: new Map(), formAnchor: none() };
  const initial: Promise<IFieldAccum> = Promise.resolve(seed);
  const step = makeFieldStep(args);
  return ordered.reduce(step, initial);
}

/**
 * Build a single-step reducer that resolves one field on top of the
 * running accumulator promise. Closes over the discovery args.
 *
 * @param args - Discovery arguments bundle.
 * @returns Reducer accepted by {@link Array.reduce}.
 */
function makeFieldStep(
  args: IDiscoverFieldsArgs,
): (acc: Promise<IFieldAccum>, field: IFieldConfig) => Promise<IFieldAccum> {
  return (acc, field) => acc.then(a => resolveAndAccumulate(args, a, field));
}

/**
 * Select the active-frame id for downstream submit resolution —
 * password's frame when password resolved, otherwise the args' frame.
 *
 * @param args - Discovery arguments bundle.
 * @param final - Final field-resolution accumulator.
 * @returns Frame id where the submit button must live.
 */
function pickActiveFrameId(args: IDiscoverFieldsArgs, final: IFieldAccum): string {
  const fallback = computeContextId(args.activeFrame, args.page);
  const passwordTarget = final.targets.get('password');
  return passwordTarget?.contextId ?? fallback;
}

/**
 * Discover all login fields via mediator and build ILoginFieldDiscovery.
 * Password resolves first (universal anchor), then others scope from it.
 * @param args - Bundled discovery arguments.
 * @returns Fully populated login field discovery.
 */
async function executeDiscoverFields(args: IDiscoverFieldsArgs): Promise<ILoginFieldDiscovery> {
  const ordered = passwordFirst(args.config.fields);
  const final = await foldDiscoveryFields(args, ordered);
  const activeFrameId = pickActiveFrameId(args, final);
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
function extractFormAnchorSelector(formAnchor: Option<IFormAnchor>): string {
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

/** WK structural submit candidates — co-erced once at module scope. */
const STRUCTURAL_SUBMIT_WK =
  WK_LOGIN_FORM.submitStructural as unknown as readonly SelectorCandidate[];

/**
 * Try the WK structural submit candidates (`button[type="submit"]`) in
 * the password frame, scoped to the form anchor when trustworthy.
 *
 * @param args - Discovery arguments bundle.
 * @param frameId - Required frame id (password's frame).
 * @param anchor - Trustworthy form-anchor selector or empty string.
 * @returns Option wrapping the structurally matched submit target.
 */
async function tryStructuralSubmit(
  args: IDiscoverFieldsArgs,
  frameId: string,
  anchor: string,
): Promise<Option<IResolvedTarget>> {
  return resolveInFrame({
    args,
    candidates: STRUCTURAL_SUBMIT_WK,
    requiredFrameId: frameId,
    formAnchor: anchor,
  });
}

/**
 * Try the bank-configured submit candidates (text/role-based) in
 * the password frame, scoped to the form anchor when trustworthy.
 *
 * @param args - Discovery arguments bundle.
 * @param frameId - Required frame id (password's frame).
 * @param anchor - Trustworthy form-anchor selector or empty string.
 * @returns Option wrapping the configured submit target.
 */
async function tryConfiguredSubmit(
  args: IDiscoverFieldsArgs,
  frameId: string,
  anchor: string,
): Promise<Option<IResolvedTarget>> {
  const raw = normalizeSubmitConfig(args.config.submit);
  return resolveInFrame({ args, candidates: raw, requiredFrameId: frameId, formAnchor: anchor });
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
  const structural = await tryStructuralSubmit(args, activeFrameId, anchorSelector);
  if (structural.has) return structural;
  return tryConfiguredSubmit(args, activeFrameId, anchorSelector);
}

/** Bundled args for resolveInFrame — keeps the function inside the 3-param ceiling. */
interface IResolveInFrameArgs {
  readonly args: IDiscoverFieldsArgs;
  readonly candidates: readonly SelectorCandidate[];
  readonly requiredFrameId: string;
  readonly formAnchor: string;
}

/** Bundled state captured once per submit-resolution race for logging + assembly. */
interface IFrameMatchArgs {
  readonly logger: IPipelineContext['logger'];
  readonly candidateVal: string;
  readonly contextId: string;
  readonly kind: string;
  readonly requiredFrameId: string;
}

/**
 * Build the bundled match metadata captured once per submit-resolution
 * race so both the wrong-frame logger and the success logger consume a
 * single argument bundle.
 *
 * @param input - Original resolve-in-frame args (carries logger handle).
 * @param result - Race result from `mediator.resolveVisible`.
 * @param contextId - Frame id of the matched element.
 * @returns Frame-match bundle for the logging + assembly helpers.
 */
function buildFrameMatchArgs(
  input: IResolveInFrameArgs,
  result: IRaceResult,
  contextId: string,
): IFrameMatchArgs {
  return {
    logger: input.args.logger,
    candidateVal: extractCandidateVal(result),
    contextId,
    kind: extractCandidateKind(result),
    requiredFrameId: input.requiredFrameId,
  };
}

/**
 * Log a wrong-frame submit-resolution outcome and return `none()` so
 * the caller can `return logFrameMismatch(matchArgs)` in one line.
 *
 * @param matchArgs - Frame-match bundle (carries the expected frame id).
 * @returns Always `none()`.
 */
function logFrameMismatch(matchArgs: IFrameMatchArgs): Option<IResolvedTarget> {
  const { candidateVal, contextId, requiredFrameId, logger } = matchArgs;
  const message = `"${candidateVal}" in ${contextId}, expected ${requiredFrameId}`;
  logger.debug({ field: 'submit', result: 'WRONG_FRAME', message });
  return none();
}

/**
 * Log a matched submit-resolution outcome — returns `true` so the call
 * site can be a single statement without a discarded-expression lint.
 *
 * @param matchArgs - Frame-match bundle from {@link buildFrameMatchArgs}.
 * @returns Always `true`.
 */
function logFrameMatch(matchArgs: IFrameMatchArgs): true {
  matchArgs.logger.debug({
    field: 'submit',
    result: 'FOUND',
    message: `"${matchArgs.candidateVal}" kind=${matchArgs.kind} frame=${matchArgs.contextId}`,
  });
  return true;
}

/**
 * Bridge to `mediator.resolveVisible` with the resolve-in-frame bundle —
 * extracted so the wrapping call fits inside the print-width budget.
 *
 * @param input - Resolve-in-frame args bundle.
 * @returns Race result from the mediator.
 */
async function resolveVisibleCandidates(input: IResolveInFrameArgs): Promise<IRaceResult> {
  return input.args.mediator.resolveVisible(input.candidates, undefined, input.formAnchor);
}

/**
 * Build the success `Option<IResolvedTarget>` for a frame-matched
 * submit-resolution race — pulled out of {@link resolveInFrame} so
 * the caller stays inside the 10-LoC ceiling without prettier-wrap.
 *
 * @param matchArgs - Frame-match bundle.
 * @param selector - Final scoped or un-scoped click selector.
 * @returns `some(target)` populated from the bundle.
 */
function buildSuccessTarget(matchArgs: IFrameMatchArgs, selector: string): Option<IResolvedTarget> {
  return some({
    selector,
    contextId: matchArgs.contextId,
    kind: matchArgs.kind,
    candidateValue: matchArgs.candidateVal,
  });
}

/**
 * Resolve a visible element strictly within a specific frame.
 * @param input - Bundled discovery args + candidates + frame + formAnchor.
 *   `formAnchor` is passed through to `mediator.resolveVisible` so Locator
 *   chaining applies form scoping uniformly to ALL candidate kinds.
 * @returns Resolved target in the correct frame, or none.
 */
async function resolveInFrame(input: IResolveInFrameArgs): Promise<Option<IResolvedTarget>> {
  const result = await resolveVisibleCandidates(input);
  if (!result.found || !result.context) return none();
  const contextId = computeContextId(result.context, input.args.page);
  const matchArgs = buildFrameMatchArgs(input, result, contextId);
  if (contextId !== matchArgs.requiredFrameId) return logFrameMismatch(matchArgs);
  logFrameMatch(matchArgs);
  const selector = buildSubmitSelector(result, input.formAnchor);
  return buildSuccessTarget(matchArgs, selector);
}

/** Default structural submit selector when the race has no candidate. */
const INNER_SUBMIT_FALLBACK = 'button[type="submit"]';

/**
 * Build the per-kind selector lookup for {@link buildInnerSubmitSelector}.
 * Extracted so the caller stays inside the 10-LoC ceiling.
 *
 * @param value - The candidate's `value` (text / xpath / aria name).
 * @returns Map keyed by candidate kind.
 */
function buildInnerSelectorMap(value: string): Record<string, string> {
  return {
    xpath: value,
    textContent: `text=${value}`,
    exactText: `text="${value}"`,
    placeholder: `[placeholder="${value}"]`,
    ariaLabel: `role=button[name="${value}"]`,
    labelText: `text=${value}`,
  };
}

/**
 * Build the inner (un-scoped) selector for a candidate kind.
 * @param result - Race result from resolveVisible.
 * @returns Inner selector string without form scope.
 */
function buildInnerSubmitSelector(result: IRaceResult): string {
  if (!result.candidate) return INNER_SUBMIT_FALLBACK;
  const c = result.candidate;
  // ariaLabel kind matches by accessible name, not the [aria-label] attribute.
  // PRE uses `getByRole('button', { name })`; click-time storage must use the
  // role engine to agree. Max's user-login-form button derives its name from
  // an inner <span> and has no aria-label attr — `[aria-label="..."]` would
  // match 0 elements and the click would silently no-op.
  const selectorMap = buildInnerSelectorMap(c.value);
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
 * LOGIN.PRE prelude spec — DOM-ready ceiling for the iframe-hosted
 * login form. Frame-targeted variant of the BasePhase hook because
 * LOGIN.PRE must wait on the active iframe (Hapoalim-group banks),
 * not the top-level page.
 */
const LOGIN_PRE_FRAME_PRELUDE: IPreludeSpec = {
  level: 'dom',
  timeoutMs: ELEMENTS_DOM_READY_TIMEOUT_MS,
};

/** Failure messages for the LOGIN PRE gates. */
const LOGIN_PRE_NO_BROWSER = 'LOGIN PRE: no browser';
const LOGIN_PRE_NO_MEDIATOR = 'LOGIN PRE: no mediator';

/**
 * Probe the page for a Firefox-style network-error chrome and convert
 * any positive verdict into a structured fail-loud procedure.
 *
 * @param page - Browser page (just landed on the bank's login domain).
 * @returns Failure procedure when the chrome is detected, `false`
 *   when the page is normal.
 */
async function probeNeterrorAndFail(page: Page): Promise<Procedure<IPipelineContext> | false> {
  // PR #221 review-fix session 2026-05-11: the HOME → LOGIN navigation
  // (HOME.ACTION clicks the login-link nav, page lands on the bank's
  // dedicated login subdomain) can hit Firefox's built-in neterror page
  // if DNS / TCP / TLS fails for the SECOND domain (Discount lands on
  // start.telebank.co.il from discountbank.co.il; only the second hop
  // can flake while the first succeeded). INIT.POST's gate only sees
  // the first navigation; LOGIN.PRE is the first phase that reads the
  // post-second-hop content, so it owns the cold-start gate for this
  // navigation. Fails loud immediately so the 25-30s downstream
  // cascade (HOME.FINAL → LOGIN.ACTION → LOGIN.POST → AUTH-DISCOVERY)
  // is short-circuited and the run reports a real diagnosis.
  const probe = await probeFirefoxNeterror(page);
  if (!probe.isNeterror) return false;
  const pageUrl = page.url();
  const maskedUrl = maskVisibleText(pageUrl);
  const msg = `LOGIN PRE: browser error page — title="${probe.title}" url=${maskedUrl}`;
  return fail(ScraperErrorTypes.Generic, msg);
}

/** Outcome of {@link runDiscoverFormPreamble} — fail-loud or active frame. */
type DiscoverFormPreamble =
  | { readonly tag: 'fail'; readonly proc: Procedure<IPipelineContext> }
  | { readonly tag: 'frame'; readonly activeFrame: Page | Frame };

/**
 * Run LOGIN.PRE's optional readiness + preAction callbacks and surface
 * either the active frame (success) or a fail-loud procedure (failure).
 *
 * @param config - Login config.
 * @param page - Browser page.
 * @returns Tagged outcome — `'frame'` with the active frame or `'fail'`
 *   with the structured failure procedure.
 */
async function runDiscoverFormPreamble(
  config: ILoginConfig,
  page: Page,
): Promise<DiscoverFormPreamble> {
  const readyCheck = await runCheckReadiness(config, page);
  if (readyCheck !== false) return { tag: 'fail', proc: readyCheck };
  const frameResult = await runPreAction(config, page);
  if (!frameResult.success) return { tag: 'fail', proc: frameResult };
  return { tag: 'frame', activeFrame: frameResult.value };
}

/**
 * Build LOGIN.PRE's slim {@link ILoginState} and emit the active-frame
 * debug log in one helper so the caller stays a thin coordinator.
 *
 * @param activeFrame - Frame selected by `preAction` (or the page).
 * @param page - Browser page (carries the `urlBeforeSubmit` baseline).
 * @param logger - Pipeline logger for the active-frame trace line.
 * @returns Freshly built login state value.
 */
function buildLoginState(
  activeFrame: Page | Frame,
  page: Page,
  logger: IPipelineContext['logger'],
): ILoginState {
  logger.debug({ message: maskVisibleText(`activeFrame=${activeFrame.url()}`) });
  return {
    activeFrame,
    persistentOtpToken: none(),
    urlBeforeSubmit: page.url(),
  };
}

/**
 * Best-effort DOM-ready wait on the active iframe — emits the
 * `domReady=…` trace line and returns. Failures inside the prelude
 * are non-fatal; the per-frame scan retry absorbs slow SPAs.
 *
 * @param input - Pipeline context (carries the logger handle).
 * @param activeFrame - Frame to wait on (Page or iframe).
 * @returns Always `true` (the boolean return keeps the call statement
 *   self-documenting and avoids a `void` return type).
 */
async function waitFormDomReady(input: IPipelineContext, activeFrame: Page | Frame): Promise<true> {
  // Mission M4.F2.0 + dom-ready-everywhere P-7b: SPA-render wait on
  // the active iframe (Hapoalim-group banks host login inside an
  // iframe; the parent page fires `domcontentloaded` before the
  // iframe's JS bundle hydrates). Without this gate, fast SPAs
  // (Visacal / Amex / Max observed 2026-05-11) reach
  // `executeDiscoverFields` before the password input is parsed and
  // the resolver reports "no password field". Best-effort wait — the
  // per-frame scan retry absorbs slow SPAs, so a timeout is non-fatal.
  const wasReady = await awaitFramePrelude(input, activeFrame, LOGIN_PRE_FRAME_PRELUDE);
  input.logger.debug({ message: `LOGIN PRE: domReady=${String(wasReady)}` });
  return true;
}

/** Bundled resources for {@link runDiscoverFormFlow} after early gates clear. */
interface IDiscoverFormResources {
  readonly config: ILoginConfig;
  readonly input: IPipelineContext;
  readonly page: Page;
  readonly mediator: IElementMediator;
}

/**
 * Run the field-discovery pass against the resolved active frame.
 * Bridges {@link IDiscoverFormResources} fields into the args bundle
 * consumed by {@link executeDiscoverFields}.
 *
 * @param r - Discover-form resources.
 * @param activeFrame - Frame selected by `runDiscoverFormPreamble`.
 * @returns Fully populated login-field discovery.
 */
async function runFieldDiscovery(
  r: IDiscoverFormResources,
  activeFrame: Page | Frame,
): Promise<ILoginFieldDiscovery> {
  return executeDiscoverFields({
    mediator: r.mediator,
    config: r.config,
    activeFrame,
    page: r.page,
    logger: r.input.logger,
  });
}

/**
 * Commit LOGIN.PRE's state + discovery into the pipeline context.
 *
 * @param input - Pipeline context to extend.
 * @param loginState - Freshly built login state.
 * @param discovery - Result of the field-discovery pass.
 * @returns Success procedure with the extended context.
 */
function commitDiscoverForm(
  input: IPipelineContext,
  loginState: ILoginState,
  discovery: ILoginFieldDiscovery,
): Procedure<IPipelineContext> {
  return succeed({
    ...input,
    login: some(loginState),
    loginFieldDiscovery: some(discovery),
  });
}

/**
 * Run the post-gate LOGIN.PRE flow: neterror probe → preamble → state +
 * dom-ready wait → field discovery → commit. Single linear sequence so
 * the entry point in {@link executeDiscoverForm} stays a thin gate.
 *
 * @param r - Discover-form resources (config + context + page + mediator).
 * @returns Updated context with login state and field discovery.
 */
async function runDiscoverFormFlow(
  r: IDiscoverFormResources,
): Promise<Procedure<IPipelineContext>> {
  const neterror = await probeNeterrorAndFail(r.page);
  if (neterror !== false) return neterror;
  const preamble = await runDiscoverFormPreamble(r.config, r.page);
  if (preamble.tag === 'fail') return preamble.proc;
  const loginState = buildLoginState(preamble.activeFrame, r.page, r.input.logger);
  await waitFormDomReady(r.input, preamble.activeFrame);
  const discovery = await runFieldDiscovery(r, preamble.activeFrame);
  return commitDiscoverForm(r.input, loginState, discovery);
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
  if (!input.browser.has) return fail(ScraperErrorTypes.Generic, LOGIN_PRE_NO_BROWSER);
  if (!input.mediator.has) return fail(ScraperErrorTypes.Generic, LOGIN_PRE_NO_MEDIATOR);
  const page = input.browser.value.page;
  const mediator = input.mediator.value;
  return runDiscoverFormFlow({ config, input, page, mediator });
}

/** Failure messages for the LOGIN ACTION early gates. */
const LOGIN_ACTION_NO_DISCOVERY = 'LOGIN ACTION: no field discovery';
const LOGIN_ACTION_NO_EXECUTOR = 'LOGIN ACTION: no executor';

/** Outcome of {@link gateActionInputs} — pre-narrowed inputs or a failure procedure. */
type ActionInputsGate =
  | {
      readonly tag: 'ok';
      readonly discovery: ILoginFieldDiscovery;
      readonly executor: IActionMediator;
    }
  | { readonly tag: 'fail'; readonly proc: IProcedureFailure };

/**
 * Gate the LOGIN ACTION inputs (discovery + executor) and surface
 * either the pre-narrowed values or a structured failure procedure.
 *
 * @param input - Sealed ACTION context.
 * @returns Tagged result — `'ok'` with narrowed values or `'fail'`.
 */
function gateActionInputs(input: IActionContext): ActionInputsGate {
  if (!input.loginFieldDiscovery.has) {
    return { tag: 'fail', proc: fail(ScraperErrorTypes.Generic, LOGIN_ACTION_NO_DISCOVERY) };
  }
  if (!input.executor.has) {
    return { tag: 'fail', proc: fail(ScraperErrorTypes.Generic, LOGIN_ACTION_NO_EXECUTOR) };
  }
  return { tag: 'ok', discovery: input.loginFieldDiscovery.value, executor: input.executor.value };
}

/** Bundled args for {@link runFillFromDiscovery} — under the 3-param ceiling. */
interface IRunFillArgs {
  readonly config: ILoginConfig;
  readonly input: IActionContext;
  readonly discovery: ILoginFieldDiscovery;
  readonly executor: IActionMediator;
}

/**
 * Run the sealed fill+submit executor against the PRE-resolved
 * discovery. Bridges {@link IActionContext} fields into the
 * mediator-agnostic `fillFromDiscovery` signature.
 *
 * @param args - Bundled config + context + pre-narrowed discovery + executor.
 * @returns Fill outcome from `fillFromDiscovery`.
 */
async function runFillFromDiscovery(
  args: IRunFillArgs,
): Promise<Awaited<ReturnType<typeof fillFromDiscovery>>> {
  const creds = args.input.credentials as Record<string, string>;
  return fillFromDiscovery({
    discovery: args.discovery,
    executor: args.executor,
    config: args.config,
    creds,
    logger: args.input.logger,
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
  const gate = gateActionInputs(input);
  if (gate.tag === 'fail') return gate.proc;
  const { discovery, executor } = gate;
  const result = await runFillFromDiscovery({ config, input, discovery, executor });
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
 * The 3 s value matches the typical per-frame DOM scan latency on
 * the slowest SPA banks (cal-online, max) plus a 2x safety margin —
 * sourced from the central {@link LOGIN_PER_FRAME_SCAN_TIMEOUT_MS}.
 */

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
  const budget = budgetFrameScan(LOGIN_PER_FRAME_SCAN_TIMEOUT_MS);
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

/** Failure messages for the LOGIN POST early gates. */
const LOGIN_POST_NO_LOGIN_STATE = 'LOGIN POST: no login state';
const LOGIN_POST_NO_BROWSER = 'LOGIN POST: no browser';

/**
 * Run the loading-gate wait + early auth-API watcher — fast-path that
 * either fails loud (loading rejected, watcher already fired) or
 * returns `false` so the caller continues to the legacy detectors.
 *
 * @param mediator - Element mediator (loading + auth-failure watcher).
 * @param activeFrame - LOGIN PRE's captured active frame.
 * @returns Failure procedure on early fail, otherwise `false`.
 */
async function runPostLoadingGate(
  mediator: IElementMediator,
  activeFrame: Page | Frame,
): Promise<Procedure<IPipelineContext> | false> {
  const loadingDone = await mediator.waitForLoadingDone(activeFrame);
  if (!loadingDone.success) return loadingDone;
  // Generic auth-API watcher — fast-path for any bank whose auth endpoint
  // already signalled failure (4xx or body-error) by the time the page
  // settled. Wins races against the slow URL/DOM detectors below for
  // SPA banks that never URL-redirect on rejected creds.
  return detectAuthApiFailure(mediator);
}

/** Bundled args for {@link runPostFormScanAndCallback} — under the 3-param ceiling. */
interface IPostFormScanArgs {
  readonly mediator: IElementMediator;
  readonly config: ILoginConfig;
  readonly input: IPipelineContext;
  readonly page: Page;
}

/**
 * Run the main-frame error scan plus the SPA-traffic wait and POST
 * callback. Returns a failure procedure on any caught error, otherwise
 * `false` so the caller can fall through to the late-fire detectors.
 *
 * @param args - Bundled mediator + config + context + page.
 * @returns Failure procedure on detected error, otherwise `false`.
 */
async function runPostFormScanAndCallback(
  args: IPostFormScanArgs,
): Promise<Procedure<IPipelineContext> | false> {
  // Scan the main frame only — iframes on SPA banks (cal-online stack)
  // carry stale pre-submit validation placeholders that produce false
  // positives against valid credentials. Invalid-creds detection for
  // SPA banks falls through to detectLoginBounce below (URL pathname
  // stays on the login path after a rejected submit).
  const errors = await safeScanFrame(args.mediator, args.page);
  if (errors.hasErrors) return fail(ScraperErrorTypes.InvalidPassword, `Form: ${errors.summary}`);
  await waitForPostLoginTraffic(args.mediator, args.input.logger);
  const cbResult = await runPostCallback(args.page, args.config, args.input);
  if (!cbResult.success) return cbResult;
  return false;
}

/**
 * Run the late-fire auth-failure + async DOM detectors after the
 * loading gate + POST callback have settled. Returns the first hit
 * or falls through to {@link runLatePostChecks}.
 *
 * @param mediator - Element mediator (URL + watcher + DOM probes).
 * @param input - Pipeline context.
 * @returns Resolved Procedure for the late checks.
 */
async function runPostLateChecks(
  mediator: IElementMediator,
  input: IPipelineContext,
): Promise<Procedure<IPipelineContext>> {
  // M2: dashboard-redirect orchestration removed. AUTH-DISCOVERY
  // (which runs after LOGIN/OTP-FILL) owns dashboard-readiness via
  // its FINAL-stage probe and emits `ctx.authDiscovery.dashboardReady`.
  // LOGIN.POST validates ONLY the action's scope from here on.
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
  if (!input.login.has) return fail(ScraperErrorTypes.Generic, LOGIN_POST_NO_LOGIN_STATE);
  if (!input.browser.has) return fail(ScraperErrorTypes.Generic, LOGIN_POST_NO_BROWSER);
  const page = input.browser.value.page;
  const earlyGate = await runPostLoadingGate(mediator, input.login.value.activeFrame);
  if (earlyGate !== false) return earlyGate;
  const formScan = await runPostFormScanAndCallback({ mediator, config, input, page });
  if (formScan !== false) return formScan;
  return runPostLateChecks(mediator, input);
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
  const scopeIntact = await validateActionScopeIntact(mediator, input);
  if (scopeIntact !== false) return scopeIntact;
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

/**
 * M2 (CI quality hardening) — scope-bound LOGIN.POST validation.
 *
 * <p>Replaces the deleted `detectLoginFormStillPresent`. The legacy
 * helper polled the password selector for up to 5–10 s and failed
 * loud when the form persisted. That signal is wrong on SPA banks
 * whose post-submit screen retains the same field elements: Hapoalim's
 * OTP screen keeps both `#password` and `#userCode` for ~5 s after
 * submit, producing a false-positive `INVALID_PASSWORD` on every
 * device-remembered login. CI evidence: run 25590782956, job
 * 75128327913 — both fields stayed at count=1 throughout the entire
 * 10 s budget.
 *
 * <p>The new check combines THREE signals:
 * <ul>
 *   <li>URL still on the login pathname (no redirect happened) — the
 *       success case for Hapoalim is URL changes to `/otp` or
 *       `/dashboard`, so this branch returns `false` immediately and
 *       never probes the form.</li>
 *   <li>The original password element from PRE is still resolvable
 *       in the DOM — combined with the URL guard, this is AMBIGUOUS
 *       (could be invalid creds OR Hapoalim's OTP transition where
 *       the password input lingers).</li>
 *   <li>Mission M4.F2.0: on the ambiguous branch, probe for an OTP
 *       trigger or OTP-input element. Its presence is the bank's
 *       definitive "credentials accepted, awaiting second factor"
 *       signal — fall through to the OTP-TRIGGER phase rather than
 *       firing a false-positive `INVALID_PASSWORD`. Cross-validated
 *       against Hapoalim run `11-05-2026_02331101` where the auth
 *       POST `/authenticate/init` returned successfully but the SPA
 *       kept the password input visible while rendering the OTP
 *       screen.</li>
 * </ul>
 *
 * <p>This validation runs AFTER `detectAuthApiFailure` and
 * `detectAsyncLoginErrors`, so banks that emit explicit auth errors
 * fail through those channels first. `validateActionScopeIntact` is
 * the safety net for SPA banks that silently re-render with no
 * structured error signal.
 *
 * @param mediator - Element mediator (URL + selector count + OTP probes).
 * @param input - Pipeline context carrying `loginFieldDiscovery` from
 *   PRE and `diagnostics.loginUrl` from HOME.
 * @returns Failure procedure when the action's scope is still intact,
 *   URL hasn't changed, AND no OTP screen rendered; `false` (keep
 *   going) otherwise.
 */
async function validateActionScopeIntact(
  mediator: IElementMediator,
  input: IPipelineContext,
): Promise<Procedure<IPipelineContext> | false> {
  const probe = await probeScopeIntact(mediator, input);
  if (probe === false) return false;
  const scopeArgs: IScopeIntactArgs = {
    input,
    selector: probe.target.selector,
    count: probe.count,
  };
  return disambiguateScopeIntact(mediator, scopeArgs);
}

/** Diagnostic log messages used by {@link validateActionScopeIntact}. */
const SCOPE_OTP_VISIBLE_LOG = 'POST: scope intact but OTP screen rendered — fall through';
const SCOPE_OTP_UNKNOWN_LOG = 'POST: OTP probe failed — fall through (unknown ≠ invalid)';
const SCOPE_INTACT_FAIL_MSG =
  'LOGIN POST: scope intact + URL unchanged — credentials likely invalid';

/**
 * Bundled state for {@link emitScopeIntactFailure} — keeps the helper
 * within the 3-param ceiling and the caller within 10 LoC.
 */
interface IScopeIntactArgs {
  readonly input: IPipelineContext;
  readonly selector: string;
  readonly count: number;
}

/**
 * Emit the structured "scope intact + URL unchanged" failure procedure
 * after the OTP-screen disambiguator has already cleared the false-
 * positive branches.
 *
 * @param args - Bundled context + selector + count for the diagnostic log.
 * @returns Failure procedure tagged `InvalidPassword`.
 */
function emitScopeIntactFailure(args: IScopeIntactArgs): IProcedureFailure {
  const masked = maskVisibleText(args.selector);
  const countStr = String(args.count);
  args.input.logger.debug({
    message: `POST: scope intact + URL unchanged — selector ${masked} count=${countStr}`,
  });
  return fail(ScraperErrorTypes.InvalidPassword, SCOPE_INTACT_FAIL_MSG);
}

/**
 * Disambiguate an "ambiguous scope intact" outcome via the OTP-screen
 * probe. Returns `false` to fall through when OTP is visible or the
 * probe failed; returns the assembled failure procedure otherwise.
 *
 * @param mediator - Element mediator (for the OTP probe).
 * @param scopeArgs - Bundled scope state (context, selector, count).
 * @returns Failure procedure on confirmed scope-intact failure, else `false`.
 */
/** Lookup mapping OTP-visibility verdicts → the fall-through trace log. */
const SCOPE_OTP_FALLTHROUGH_LOGS: Record<string, string> = {
  true: SCOPE_OTP_VISIBLE_LOG,
  unknown: SCOPE_OTP_UNKNOWN_LOG,
};

/**
 * Resolve the fall-through trace log for an "OTP visible" or "OTP
 * unknown" outcome — both branches log + return `false` in the caller.
 *
 * @param visibility - Tri-state OTP-visibility verdict.
 * @returns Trace log string when fall-through applies, else `false`.
 */
function pickOtpFallthroughLog(visibility: OtpScreenVisibility): string | false {
  if (visibility === false) return false;
  const key = visibility === true ? 'true' : 'unknown';
  return SCOPE_OTP_FALLTHROUGH_LOGS[key] ?? false;
}

/**
 * Choose between accepting an OTP fall-through (returning `false`) or
 * emitting a structured scope-intact failure. Delegates the tri-state
 * verdict to {@link pickOtpFallthroughLog} and the failure shaping to
 * {@link emitScopeIntactFailure}.
 *
 * @param mediator - Element mediator for the OTP visibility probe.
 * @param scopeArgs - Scope-intact bundle (input + diagnostics).
 * @returns Failure procedure when the scope is broken, `false` when
 *   the OTP fall-through is accepted.
 */
async function disambiguateScopeIntact(
  mediator: IElementMediator,
  scopeArgs: IScopeIntactArgs,
): Promise<Procedure<IPipelineContext> | false> {
  const otpVisibility = await otpScreenVisible(mediator);
  const fallthrough = pickOtpFallthroughLog(otpVisibility);
  if (fallthrough !== false) {
    scopeArgs.input.logger.debug({ message: fallthrough });
    return false;
  }
  return emitScopeIntactFailure(scopeArgs);
}

/**
 * Run the cheap structural pre-checks for {@link validateActionScopeIntact}
 * — URL stability + password-target presence + DOM-count guard. Returns
 * the password target with its current count when all guards pass.
 *
 * @param mediator - Element mediator (URL + count probes).
 * @param input - Pipeline context with `loginFieldDiscovery`.
 * @returns Resolved target + count when guards pass, otherwise `false`.
 */
async function probeScopeIntact(
  mediator: IElementMediator,
  input: IPipelineContext,
): Promise<{ readonly target: IResolvedTarget; readonly count: number } | false> {
  if (!hasStayedOnLoginUrl(mediator, input)) return false;
  if (!input.loginFieldDiscovery.has) return false;
  const target = input.loginFieldDiscovery.value.targets.get(LOGIN_FIELDS.PASSWORD);
  if (!target) return false;
  const count = await mediator.countBySelector(target.selector);
  if (count === 0) return false;
  return { target, count };
}

/**
 * Tri-state outcome for {@link otpScreenVisible}.
 * <ul>
 *   <li>`true` — at least one probe returned a positive "found" signal.</li>
 *   <li>`false` — both probes returned definitive "not found" results.</li>
 *   <li>`'unknown'` — at least one probe failed (transient resolver
 *       error). The caller must NOT treat this as "not visible"
 *       (would re-create the INVALID_PASSWORD false-positive this
 *       branch was added to prevent).</li>
 * </ul>
 */
type OtpScreenVisibility = boolean | 'unknown';

/** Outcome of a single OTP detect call — race result or probe failure. */
type ProbeOutcome = IRaceResult | 'failed';

/** Sentinel for {@link runOtpDetect}'s catch arm. */
const PROBE_FAILED: ProbeOutcome = 'failed';

/**
 * Translate a {@link Procedure} into a flat {@link ProbeOutcome}. Pulled
 * out of {@link runOtpDetect} so the body stays inside the max-depth
 * ceiling — try/catch + if-branch would otherwise nest beyond 1.
 *
 * @param result - Probe-side Procedure result.
 * @returns Race result on success; `'failed'` on `success: false`.
 */
function unwrapOtpProcedure(result: Procedure<IRaceResult>): ProbeOutcome {
  if (!result.success) return PROBE_FAILED;
  return result.value;
}

/**
 * Run a single OTP detect probe and translate its `Procedure` shape
 * (or any rejected resolver promise) into a flat {@link ProbeOutcome}.
 * Rejections of the underlying `resolveVisible` propagate out of
 * `detectOtpTrigger` / `detectOtpForm` today (they `await` without a
 * `.catch`), so this wrapper absorbs them here and signals `'failed'`.
 *
 * @param probe - OTP-screen detector function reference.
 * @param mediator - Element mediator threaded through to the detector.
 * @returns Race result on success; `'failed'` on resolver rejection.
 */
async function runOtpDetect(
  probe: (m: IElementMediator) => Promise<Procedure<IRaceResult>>,
  mediator: IElementMediator,
): Promise<ProbeOutcome> {
  const result = await probe(mediator).catch((): false => false);
  if (result === false) return PROBE_FAILED;
  return unwrapOtpProcedure(result);
}

/**
 * Probes the post-submit DOM for an OTP-trigger or OTP-input element.
 *
 * <p>Mission M4.F2.0 disambiguator for {@link validateActionScopeIntact}:
 * when the URL is unchanged AND the password element still resolves
 * (Hapoalim's known SPA pattern), the presence of an OTP element is
 * the bank's confirmation that credentials were accepted and the run
 * should proceed to OTP-TRIGGER instead of failing as
 * `INVALID_PASSWORD`. Probes run in parallel so the worst-case wait
 * is one `OTP_FORM_PROBE_TIMEOUT_MS` ceiling, not two.
 *
 * <p>PR #221 review (id 3216542548): probe FAILURES (transient
 * resolver errors) are NOT the same as probe results of "not found".
 * Collapsing both into `false` recreates the INVALID_PASSWORD
 * false-positive on transient flakes. Returns `'unknown'` so the
 * caller can choose to fall through instead of failing closed.
 *
 * @param mediator - Element mediator passed through to OTP probes.
 * @returns `true` when an OTP-trigger or OTP-input element is visible;
 *   `false` when both probes definitively did not find one;
 *   `'unknown'` when at least one probe failed.
 */
async function otpScreenVisible(mediator: IElementMediator): Promise<OtpScreenVisibility> {
  const triggerProbe = runOtpDetect(detectOtpTrigger, mediator);
  const formProbe = runOtpDetect(detectOtpForm, mediator);
  const [triggerOutcome, formOutcome] = await Promise.all([triggerProbe, formProbe]);
  if (triggerOutcome !== 'failed' && triggerOutcome.found) return true;
  if (formOutcome !== 'failed' && formOutcome.found) return true;
  if (triggerOutcome === 'failed' || formOutcome === 'failed') return 'unknown';
  return false;
}

/** Sentinel for the "no bounce" early-exit branches. */
const BOUNCE_FAIL_MSG_PREFIX = 'LOGIN POST: bounced back to login path';

/**
 * True when the post-submit URL is the SAME login URL — verbatim or
 * with a trailing `#`. Pure URL comparison; does NOT consider path
 * equality alone (that case is the bounce condition).
 *
 * @param loginUrl - Captured login URL from HOME.
 * @param currentUrl - Browser URL after the submit.
 * @returns True when the URLs are byte-identical or differ only by `#`.
 */
function isSameLoginLocation(loginUrl: string, currentUrl: string): boolean {
  if (currentUrl === loginUrl) return true;
  if (currentUrl === `${loginUrl}#`) return true;
  return false;
}

/**
 * Build the structured bounce-failure procedure plus the diagnostic
 * debug log. Pure builder so {@link detectLoginBounce} can stay a thin
 * coordinator inside the 10-LoC ceiling.
 *
 * @param input - Pipeline context (for the logger handle).
 * @param currentUrl - Browser URL where the bounce was detected.
 * @param loginPath - Pathname of the captured login URL.
 * @returns Failure procedure tagged `InvalidPassword`.
 */
function buildBounceFailure(
  input: IPipelineContext,
  currentUrl: string,
  loginPath: string,
): IProcedureFailure {
  const masked = maskVisibleText(currentUrl);
  input.logger.debug({
    message: `POST: login bounce detected — still on ${loginPath} (url=${masked})`,
  });
  return fail(ScraperErrorTypes.InvalidPassword, `${BOUNCE_FAIL_MSG_PREFIX} ${loginPath}`);
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
  if (isSameLoginLocation(loginUrl, currentUrl)) return false;
  const loginPath = loginPathOf(loginUrl);
  if (loginPath !== loginPathOf(currentUrl)) return false;
  return buildBounceFailure(input, currentUrl, loginPath);
}

export { executeLoginSignal } from './LoginCookieAudit.js';
export { executeDiscoverForm, executeFillAndSubmitFromDiscovery, executeValidateLogin };
// Internal helpers exposed only for focused unit tests. Do NOT import
// outside of src/Tests/Unit/**. Safe to change without deprecation.
export {
  detectAsyncLoginErrors,
  discoverErrorsAllFrames,
  extractFormAnchorSelector,
  hasStayedOnLoginUrl,
  safeScanFrame,
  validateActionScopeIntact,
};
