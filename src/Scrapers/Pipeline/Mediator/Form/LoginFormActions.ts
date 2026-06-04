/**
 * Login form actions — fill fields + click submit via mediator.
 * Password resolves first (universal anchor), then others scope from it.
 * Submit clicks in the SAME frame where fields were filled.
 * All WK + DOM logic via mediator black box.
 */

import type { Frame, Page } from 'playwright-core';

import type { SelectorCandidate } from '../../../Base/Config/LoginConfigTypes.js';
import { ScraperErrorTypes } from '../../../Base/ErrorTypes.js';
import type { IFieldConfig } from '../../../Base/Interfaces/Config/FieldConfig.js';
import type { ILoginConfig } from '../../../Base/Interfaces/Config/LoginConfig.js';
import type { ScraperLogger } from '../../Types/Debug.js';
import { type MaskedText, maskVisibleText } from '../../Types/LogEvent.js';
import type { ILoginFieldDiscovery, IResolvedTarget } from '../../Types/PipelineContext.js';
import type { Procedure } from '../../Types/Procedure.js';
import { fail, succeed } from '../../Types/Procedure.js';
import type { IActionMediator, IElementMediator } from '../Elements/ElementMediator.js';
import { reduceField, validateCredentials } from './LoginFormFill.js';
import { type IFillAccum, type IFillContext, passwordFirst } from './LoginScopeResolver.js';

/** Fill result with resolved frame scope. */
interface IFillAllResult {
  readonly procedure: Procedure<boolean>;
  readonly frameContext: Page | Frame | undefined;
}

/** How the login form was submitted. */
type SubmitMethod = 'enter' | 'click' | 'both';

/** Result of fillAndSubmit — includes which submit method fired. */
interface ISubmitResult {
  readonly success: boolean;
  readonly method: SubmitMethod;
}

/**
 * Normalize submit config to array. Empty = [] (mediator handles WK fallback).
 * @param submit - Single or array of candidates.
 * @returns Array of candidates.
 */
function normalizeSubmit(submit: ILoginConfig['submit']): readonly SelectorCandidate[] {
  if (Array.isArray(submit)) return submit;
  return [submit];
}

/** Bundled args for filling all credential fields. */
interface IFillAllArgs {
  readonly mediator: IElementMediator;
  readonly fields: ILoginConfig['fields'];
  readonly creds: Record<string, string>;
  readonly logger: ScraperLogger;
}

/**
 * Run the sequential `reduceField` chain over an ordered field list.
 * Extracted from `fillAllFields` so each function stays under cap.
 * @param ctx - Fill context bundle.
 * @param ordered - Fields in password-first order.
 * @returns Final accumulator with merged scope + procedure.
 */
async function runFieldReduce(
  ctx: IFillContext,
  ordered: readonly IFieldConfig[],
): Promise<IFillAccum> {
  const seed = Promise.resolve<IFillAccum>({ scope: {}, procedure: succeed(true) });
  return ordered.reduce(
    (p: Promise<IFillAccum>, f: IFieldConfig): Promise<IFillAccum> => reduceField(ctx, p, f),
    seed,
  );
}

/**
 * Fill all credential fields sequentially via mediator.
 * Returns the resolved frame scope for submit targeting.
 * @param args - Bundled fill-all arguments.
 * @returns Fill result with frame context.
 */
async function fillAllFields(args: IFillAllArgs): Promise<IFillAllResult> {
  const { mediator, fields, creds, logger } = args;
  const validation = validateCredentials(fields, creds);
  if (!validation.success) return { procedure: validation, frameContext: undefined };
  const ordered = passwordFirst(fields);
  const ctx: IFillContext = { mediator, creds, logger };
  const final = await runFieldReduce(ctx, ordered);
  return { procedure: final.procedure, frameContext: final.scope.ctx };
}

/**
 * Try pressing Enter in the frame context to submit the form.
 * Enter fires first (native form submit), Click fires second (Angular ng-click).
 * Both are safe — fillWithFrameworkDetection updates Angular model before either fires.
 * @param frameCtx - Page or Frame where fields were filled (false if none).
 * @param logger - Pipeline logger.
 * @returns True if Enter was pressed.
 */
async function tryEnterSubmit(
  frameCtx: Page | Frame | false,
  logger: ScraperLogger,
): Promise<boolean> {
  if (!frameCtx || !('press' in frameCtx)) return false;
  const url = frameCtx.url();
  logger.debug({ method: 'enter', url: maskVisibleText(url) });
  await frameCtx.press('input', 'Enter').catch((): false => false);
  return true;
}

/** Bundled args for `tryClickSubmit` — fits the 3-param ceiling. */
interface ITryClickSubmitArgs {
  readonly mediator: IElementMediator;
  readonly config: ILoginConfig;
  readonly logger: ScraperLogger;
}

/**
 * Try clicking the submit button scoped to the discovered form.
 *
 * **Form-membership scoping via Locator chaining:** ALL candidate kinds
 * (xpath, textContent, regex, ariaLabel, ...) are scoped to descendants
 * of the discovered form. Discriminates co-resident submit buttons on
 * flip-card pages (e.g. Amex/Isracard SMS-form vs password-form).
 * @param args - Bundled try-click submit args (mediator/config/logger).
 * @returns Procedure succeed(true) if clicked, succeed(false) if not found, fail on error.
 */
async function tryClickSubmit(args: ITryClickSubmitArgs): Promise<Procedure<boolean>> {
  const { mediator, config, logger } = args;
  const candidates = normalizeSubmit(config.submit);
  const formAnchor = mediator.getFormAnchor();
  const result = await mediator.resolveAndClick(candidates, undefined, formAnchor);
  if (!result.success) return result;
  if (!result.value.found) return succeed(false);
  logger.debug({ method: 'click', url: maskVisibleText(result.value.value) });
  return succeed(true);
}

/** Bundled args for fill-and-submit. */
interface IFillAndSubmitArgs {
  readonly mediator: IElementMediator;
  readonly config: ILoginConfig;
  readonly creds: Record<string, string>;
  readonly logger: ScraperLogger;
}

/**
 * Emit a "filling N fields" debug line.
 * @param logger - Pipeline logger.
 * @param count - Number of fields about to be filled.
 * @returns True after emit (callers discard).
 */
function logFillCount(logger: ScraperLogger, count: number): true {
  logger.debug({ message: `filling ${String(count)} fields` });
  return true;
}

/**
 * Emit the post-submit debug line (method + masked current URL).
 * @param logger - Pipeline logger.
 * @param source - Anything that exposes `getCurrentUrl()` (mediator or executor).
 * @param source.getCurrentUrl - URL provider function on the source.
 * @param method - Submit method that fired (enter / click / both).
 * @returns True after emit (callers discard).
 */
function logSubmitResult(
  logger: ScraperLogger,
  source: { readonly getCurrentUrl: () => string },
  method: SubmitMethod,
): true {
  const url = source.getCurrentUrl();
  const masked = maskVisibleText(url);
  logger.debug({ method, url: masked });
  return true;
}

/** Result bundle returned by `runSubmitPhase`. */
interface ISubmitPhaseResult {
  readonly didEnter: boolean;
  readonly clickResult: Procedure<boolean>;
}

/** Bundled args for `runSubmitPhase` — fits the 3-param ceiling. */
interface ISubmitPhaseArgs {
  readonly mediator: IElementMediator;
  readonly config: ILoginConfig;
  readonly enterCtx: Page | Frame | false;
  readonly logger: ScraperLogger;
}

/**
 * Run the Enter + Click submit attempts in order.
 * Both fire so POST knows what to validate; the caller decides the outcome.
 * @param args - Bundled submit-phase args.
 * @returns Bundle of `didEnter` + `clickResult`.
 */
async function runSubmitPhase(args: ISubmitPhaseArgs): Promise<ISubmitPhaseResult> {
  const didEnter = await tryEnterSubmit(args.enterCtx, args.logger);
  const clickArgs: ITryClickSubmitArgs = {
    mediator: args.mediator,
    config: args.config,
    logger: args.logger,
  };
  const clickResult = await tryClickSubmit(clickArgs);
  return { didEnter, clickResult };
}

/**
 * Convert a submit-phase bundle into the final method label.
 * @param submit - Result bundle from `runSubmitPhase`.
 * @returns The submit method that fired (enter / click / both).
 */
function resolveSubmitFromPhase(submit: ISubmitPhaseResult): SubmitMethod {
  const didClick = submit.clickResult.success && submit.clickResult.value;
  return resolveSubmitMethod(submit.didEnter, didClick);
}

/** Bundled args for `finalizeSubmit` — used by both fill paths. */
interface IFinalizeSubmitArgs {
  readonly submit: ISubmitPhaseResult;
  readonly logger: ScraperLogger;
  readonly source: { readonly getCurrentUrl: () => string };
}

/**
 * Finalize a submit phase into the `Procedure<ISubmitResult>` callers expect:
 * propagate click failure when Enter never fired, gate the phantom-success
 * branch, then resolve the submit method and emit the success log line.
 * Extracted so `fillAndSubmit` and `fillFromDiscovery` share the tail logic.
 * @param args - Bundled finalize args (submit/logger/source).
 * @returns Procedure with ISubmitResult.
 */
function finalizeSubmit(args: IFinalizeSubmitArgs): Procedure<ISubmitResult> {
  const { submit, logger, source } = args;
  if (!submit.clickResult.success && !submit.didEnter) return submit.clickResult;
  const gate = gateNoSubmitSignal(submit);
  if (!gate.success) return gate;
  const method = resolveSubmitFromPhase(submit);
  logSubmitResult(logger, source, method);
  return succeed({ success: true, method });
}

/**
 * Fill fields then submit — Enter first, then Click.
 * Returns which method fired so POST knows what to validate.
 * @param args - Bundled fill-and-submit arguments.
 * @returns Procedure with ISubmitResult (method: enter|click|both).
 */
async function fillAndSubmit(args: IFillAndSubmitArgs): Promise<Procedure<ISubmitResult>> {
  const { mediator, config, creds, logger } = args;
  logFillCount(logger, config.fields.length);
  const fillResult = await fillAllFields({ mediator, fields: config.fields, creds, logger });
  if (!fillResult.procedure.success) return fillResult.procedure;
  const enterCtx = fillResult.frameContext ?? false;
  const submit = await runSubmitPhase({ mediator, config, enterCtx, logger });
  return finalizeSubmit({ submit, logger, source: mediator });
}

/** Submit method lookup: [didEnter][didClick] → method. */
const SUBMIT_METHOD_MAP: Record<string, SubmitMethod> = {
  'true-true': 'both',
  'true-false': 'enter',
  'false-true': 'click',
  'false-false': 'click',
};

/**
 * Resolve which submit method was used from boolean flags.
 * @param didEnter - Whether Enter was pressed.
 * @param didClick - Whether submit button was clicked.
 * @returns The submit method used.
 */
function resolveSubmitMethod(didEnter: boolean, didClick: boolean): SubmitMethod {
  const key = `${String(didEnter)}-${String(didClick)}`;
  return SUBMIT_METHOD_MAP[key];
}

// ── Discovery-based fill (PRE → ACTION handoff via ILoginFieldDiscovery) ─────

/** Bundled args for filling from PRE-resolved discovery via sealed executor. */
interface IFillFromDiscoveryArgs {
  readonly discovery: ILoginFieldDiscovery;
  readonly executor: IActionMediator;
  readonly config: ILoginConfig;
  readonly creds: Record<string, string>;
  readonly logger: ScraperLogger;
}

/**
 * Log a field fill from discovery target.
 * @param target - Pre-resolved target.
 * @param logger - Pipeline logger.
 * @returns The masked field name.
 */
function logDiscoveryFill(target: IResolvedTarget, logger: ScraperLogger): MaskedText {
  const masked = maskVisibleText(target.candidateValue);
  logger.debug({ field: masked, result: 'FOUND' });
  return masked;
}

/** Bundled args for filling one discovery field. */
interface IFillOneArgs {
  readonly executor: IFillFromDiscoveryArgs['executor'];
  readonly target: IResolvedTarget;
  readonly value: string;
  readonly logger: ScraperLogger;
}

/**
 * Fill one field from discovery via the sealed executor.
 * @param args - Bundled single-field fill arguments.
 * @returns Succeed(true) after fill.
 */
async function fillOneDiscoveryField(args: IFillOneArgs): Promise<Procedure<boolean>> {
  logDiscoveryFill(args.target, args.logger);
  await args.executor.fillInput(args.target.contextId, args.target.selector, args.value);
  return succeed(true);
}

/** Discovery entry tuple — alias used by reducer/validator helpers. */
type IDiscoveryEntry = readonly [string, IResolvedTarget];

/**
 * Find the first credential key that's missing from the creds map.
 * Returns `false` when all entries have matching credentials.
 * Extracted to keep `validateDiscoveryCredentials` under the §19.4 cap.
 * @param entries - Discovery entries with credential keys and targets.
 * @param creds - Credential map keyed by field name.
 * @returns The missing key, or false when none missing.
 */
function findMissingDiscoveryKey(
  entries: readonly IDiscoveryEntry[],
  creds: Record<string, string>,
): string | false {
  const missing = entries.filter(([key]): boolean => !creds[key]);
  if (missing.length === 0) return false;
  return missing[0][0];
}

/**
 * Validate all credentials exist before filling.
 * @param entries - Discovery entries with keys and targets.
 * @param creds - Credential map.
 * @returns Failure if any missing, succeed(true) if all present.
 */
function validateDiscoveryCredentials(
  entries: readonly IDiscoveryEntry[],
  creds: Record<string, string>,
): Procedure<boolean> {
  const missingKey = findMissingDiscoveryKey(entries, creds);
  if (missingKey === false) return succeed(true);
  return fail(ScraperErrorTypes.Generic, `Missing credential: ${missingKey}`);
}

/** Bundled args for `reduceDiscoveryFill` — fits the 3-param ceiling. */
interface IReduceDiscoveryFillArgs {
  readonly args: IFillFromDiscoveryArgs;
  readonly acc: Promise<Procedure<boolean>>;
  readonly entry: IDiscoveryEntry;
}

/**
 * Apply a single reduced fill against the previous accumulator value.
 * Short-circuits on prior failure; otherwise fills the discovery target.
 * @param rargs - Bundled reduce-fill args.
 * @param prev - Procedure value awaited from the accumulator.
 * @returns Updated procedure.
 */
function applyReducedFill(
  rargs: IReduceDiscoveryFillArgs,
  prev: Procedure<boolean>,
): Promise<Procedure<boolean>> {
  if (!prev.success) return Promise.resolve(prev);
  const [key, target] = rargs.entry;
  const value = rargs.args.creds[key];
  const { executor, logger } = rargs.args;
  return fillOneDiscoveryField({ executor, target, value, logger });
}

/**
 * Reduce one field fill onto the accumulator promise.
 * @param rargs - Bundled reduce-fill args.
 * @returns Updated accumulator.
 */
function reduceDiscoveryFill(rargs: IReduceDiscoveryFillArgs): Promise<Procedure<boolean>> {
  return rargs.acc.then((prev): Promise<Procedure<boolean>> => applyReducedFill(rargs, prev));
}

/** Reducer signature for the discovery-fill chain. */
type IDiscoveryFillReducer = (
  acc: Promise<Procedure<boolean>>,
  entry: IDiscoveryEntry,
) => Promise<Procedure<boolean>>;

/**
 * Build a reducer closure bound to a single fill-from-discovery args bundle.
 * Extracted so `fillFieldsFromDiscovery` stays under the §19.4 line cap.
 * @param args - Bundled fill-from-discovery arguments.
 * @returns Reducer suitable for `entries.reduce(...)`.
 */
function makeDiscoveryFillReducer(args: IFillFromDiscoveryArgs): IDiscoveryFillReducer {
  return (acc, entry): Promise<Procedure<boolean>> => reduceDiscoveryFill({ args, acc, entry });
}

/**
 * Fill all fields from discovery targets via frame registry + deepFillInput.
 * No field resolution — uses pre-resolved contextId + selector from PRE.
 * @param args - Bundled fill-from-discovery arguments.
 * @returns Procedure succeed(true) on success.
 */
async function fillFieldsFromDiscovery(args: IFillFromDiscoveryArgs): Promise<Procedure<boolean>> {
  const entries = [...args.discovery.targets.entries()];
  const validation = validateDiscoveryCredentials(entries, args.creds);
  if (!validation.success) return validation;
  const initial = succeed(true);
  const seed: Promise<Procedure<boolean>> = Promise.resolve(initial);
  const reducer = makeDiscoveryFillReducer(args);
  return entries.reduce(reducer, seed);
}

/** Bundled args for `tryEnterFromDiscovery` — fits the 3-param ceiling. */
interface ITryEnterDiscoveryArgs {
  readonly executor: IActionMediator;
  readonly activeFrameId: string;
  readonly logger: ScraperLogger;
}

/**
 * Try pressing Enter via sealed executor.
 * @param args - Bundled try-enter discovery args (executor/activeFrameId/logger).
 * @returns True only when pressEnter resolved against a non-empty
 *   frame ID; false when the ID is empty OR pressEnter rejected.
 */
async function tryEnterFromDiscovery(args: ITryEnterDiscoveryArgs): Promise<boolean> {
  const { executor, activeFrameId, logger } = args;
  if (!activeFrameId) return false;
  logger.debug({ method: 'enter', url: maskVisibleText(activeFrameId) });
  return executor
    .pressEnter(activeFrameId)
    .then((): true => true)
    .catch((): false => false);
}

/**
 * Map a clickElement rejection to a uniform Procedure failure.
 * Extracted from tryClickSubmitFromDiscovery to keep its body ≤10 LoC.
 * @param error - Rejection value from the click promise.
 * @returns Failure with normalized "click rejected: …" message.
 */
function mapClickRejection(error: unknown): Procedure<boolean> {
  const msg = error instanceof Error ? error.message : String(error);
  return fail(ScraperErrorTypes.Generic, `click rejected: ${msg}`);
}

/** Bundled args for `tryClickSubmitFromDiscovery` — fits the 3-param ceiling. */
interface ITryClickDiscoveryArgs {
  readonly executor: IActionMediator;
  readonly discovery: ILoginFieldDiscovery;
  readonly logger: ScraperLogger;
}

/**
 * Run the discovery-mode click against a pre-resolved target, mapping
 * resolve→succeed(true) and reject→`mapClickRejection`. Extracted so
 * `tryClickSubmitFromDiscovery` stays under the §19.4 line cap.
 * @param executor - Sealed action mediator.
 * @param target - Pre-resolved click target.
 * @returns succeed(true) on click, fail on rejection.
 */
function runDiscoveryClick(
  executor: IActionMediator,
  target: IResolvedTarget,
): Promise<Procedure<boolean>> {
  const clickArgs = { contextId: target.contextId, selector: target.selector };
  /**
   * Promise.then sentinel — wraps the click resolution in `succeed(true)`.
   * @returns Always succeed(true).
   */
  const succeeded = (): Procedure<boolean> => succeed(true);
  return executor.clickElement(clickArgs).then(succeeded).catch(mapClickRejection);
}

/**
 * Try clicking the submit button from a PRE-resolved discovery target.
 * Mirrors `tryClickSubmit` shape so the discovery path reports real
 * click outcomes instead of swallowing errors silently.
 * @param args - Bundled try-click discovery args (executor/discovery/logger).
 * @returns succeed(true) on click, succeed(false) when no submit target,
 *   fail when the click rejected.
 */
async function tryClickSubmitFromDiscovery(
  args: ITryClickDiscoveryArgs,
): Promise<Procedure<boolean>> {
  const { executor, discovery, logger } = args;
  if (!discovery.submitTarget.has) return succeed(false);
  const target = discovery.submitTarget.value;
  logger.debug({ method: 'click', url: maskVisibleText(target.candidateValue) });
  return runDiscoveryClick(executor, target);
}

/**
 * Run the discovery-mode submit attempts (Enter + Click) and capture
 * both outcomes. Mirrors `runSubmitPhase` so the caller can decide.
 * @param args - Bundled fill-from-discovery arguments.
 * @returns Bundle of `didEnter` + `clickResult`.
 */
/**
 * Build the bundled args for `tryEnterFromDiscovery`. Extracted so
 * `submitViaDiscovery` stays under the §19.4 line cap.
 * @param args - Bundled fill-from-discovery arguments.
 * @returns Try-enter discovery args bundle.
 */
function buildEnterDiscoveryArgs(args: IFillFromDiscoveryArgs): ITryEnterDiscoveryArgs {
  const { executor, logger, discovery } = args;
  return { executor, activeFrameId: discovery.activeFrameId, logger };
}

/**
 * Run the discovery-mode submit attempts (Enter + Click) and capture
 * both outcomes. Mirrors `runSubmitPhase` so the caller can decide.
 * @param args - Bundled fill-from-discovery arguments.
 * @returns Bundle of `didEnter` + `clickResult`.
 */
async function submitViaDiscovery(args: IFillFromDiscoveryArgs): Promise<ISubmitPhaseResult> {
  const { executor, logger, discovery } = args;
  const enterArgs = buildEnterDiscoveryArgs(args);
  const didEnter = await tryEnterFromDiscovery(enterArgs);
  const clickResult = await tryClickSubmitFromDiscovery({ executor, discovery, logger });
  return { didEnter, clickResult };
}

/**
 * Detect whether any submit signal actually fired in the discovery path.
 * @param submit - Submit-phase bundle.
 * @returns True when Enter fired OR click resolved with value=true.
 */
function didAnySubmitFire(submit: ISubmitPhaseResult): boolean {
  const didClick = submit.clickResult.success && submit.clickResult.value;
  return submit.didEnter || didClick;
}

/**
 * Gate the no-submit-signal branch — returns a failure when neither
 * Enter nor Click fired (phantom-success guard). Extracted from
 * fillFromDiscovery to keep its body ≤10 LoC.
 * @param submit - Submit-phase bundle.
 * @returns succeed(true) when at least one signal fired; failure otherwise.
 */
function gateNoSubmitSignal(submit: ISubmitPhaseResult): Procedure<true> {
  if (didAnySubmitFire(submit)) return succeed(true);
  return fail(ScraperErrorTypes.Generic, 'No submit signal fired (Enter and click both absent)');
}

/**
 * Run the prerequisites for discovery-mode submit: log field count,
 * validate credentials, and fill all discovered fields. Extracted
 * from fillFromDiscovery to keep its body ≤10 LoC.
 * @param args - Bundled fill-from-discovery arguments.
 * @returns Procedure succeed(true) when ready to submit; failure propagated.
 */
async function runDiscoveryPrereqs(args: IFillFromDiscoveryArgs): Promise<Procedure<true>> {
  logFillCount(args.logger, args.discovery.targets.size);
  const validation = validateCredentials(args.config.fields, args.creds);
  if (!validation.success) return validation;
  const fillResult = await fillFieldsFromDiscovery(args);
  if (!fillResult.success) return fillResult;
  return succeed(true);
}

/**
 * Fill from PRE-resolved field discovery + submit via sealed executor.
 * No field resolution in ACTION — all targets come from PRE discovery.
 * Mirrors `fillAndSubmit` shape: propagates click-failure when Enter
 * never fired, and refuses to claim success when nothing fired at all.
 * @param args - Bundled fill-from-discovery arguments.
 * @returns Procedure with ISubmitResult.
 */
async function fillFromDiscovery(args: IFillFromDiscoveryArgs): Promise<Procedure<ISubmitResult>> {
  const prereqs = await runDiscoveryPrereqs(args);
  if (!prereqs.success) return prereqs;
  const submit = await submitViaDiscovery(args);
  return finalizeSubmit({ submit, logger: args.logger, source: args.executor });
}

export type { IFillFromDiscoveryArgs, ISubmitResult, SubmitMethod };
export { fillAllFields, fillAndSubmit, fillFromDiscovery };
