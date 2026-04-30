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
import { reduceField, validateCredentials } from '../Login/LoginFillStep.js';
import { type IFillAccum, type IFillContext, passwordFirst } from './LoginScopeResolver.js';

/** Fill result with resolved frame scope. */
interface IFillAllResult {
  readonly procedure: Procedure<boolean>;
  readonly frameContext: Page | Frame | undefined;
}

/** How the login form was submitted. */
type SubmitMethod = 'enter' | 'click' | 'both';

/** Result of fillAndSubmit — includes which submit method fired. */
/** Whether the submit operation succeeded. */
type SubmitSuccess = boolean;
interface ISubmitResult {
  readonly success: SubmitSuccess;
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
  const seed = Promise.resolve<IFillAccum>({ scope: {}, procedure: succeed(true) });
  const final = await ordered.reduce(
    (p: Promise<IFillAccum>, f: IFieldConfig): Promise<IFillAccum> => reduceField(ctx, p, f),
    seed,
  );
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

/**
 * Try clicking the submit button scoped to the discovered form.
 * @param mediator - Element mediator.
 * @param config - Login config.
 * @param logger - Pipeline logger.
 * @returns Procedure succeed(true) if clicked, succeed(false) if not found, fail on error.
 */
async function tryClickSubmit(
  mediator: IElementMediator,
  config: ILoginConfig,
  logger: ScraperLogger,
): Promise<Procedure<boolean>> {
  const candidates = normalizeSubmit(config.submit);
  const scoped = mediator.scopeToForm(candidates);
  const result = await mediator.resolveAndClick(scoped);
  if (!result.success) return result;
  if (!result.value.found) return succeed(false);
  const masked = maskVisibleText(result.value.value);
  logger.debug({ method: 'click', url: masked });
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
 * Fill fields then submit — Enter first, then Click.
 * Returns which method fired so POST knows what to validate.
 * @param args - Bundled fill-and-submit arguments.
 * @returns Procedure with ISubmitResult (method: enter|click|both).
 */
async function fillAndSubmit(args: IFillAndSubmitArgs): Promise<Procedure<ISubmitResult>> {
  const { mediator, config, creds, logger } = args;
  const count = String(config.fields.length);
  logger.debug({ message: `filling ${count} fields` });
  const fillResult = await fillAllFields({ mediator, fields: config.fields, creds, logger });
  if (!fillResult.procedure.success) return fillResult.procedure;
  const enterCtx = fillResult.frameContext ?? false;
  const didEnter = await tryEnterSubmit(enterCtx, logger);
  const clickResult = await tryClickSubmit(mediator, config, logger);
  if (!clickResult.success && !didEnter) return clickResult;
  const didClick = clickResult.success && clickResult.value;
  const method = resolveSubmitMethod(didEnter, didClick);
  const currentUrl = mediator.getCurrentUrl();
  const maskedUrl = maskVisibleText(currentUrl);
  logger.debug({ method, url: maskedUrl });
  return succeed({ success: true, method });
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

/** Credential value to fill into an input field. */
type CredentialValue = string;

/** Bundled args for filling one discovery field. */
interface IFillOneArgs {
  readonly executor: IFillFromDiscoveryArgs['executor'];
  readonly target: IResolvedTarget;
  readonly value: CredentialValue;
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

/**
 * Validate all credentials exist before filling.
 * @param entries - Discovery entries with keys and targets.
 * @param creds - Credential map.
 * @returns Failure if any missing, succeed(true) if all present.
 */
function validateDiscoveryCredentials(
  entries: readonly (readonly [string, IResolvedTarget])[],
  creds: Record<string, string>,
): Procedure<boolean> {
  const missing = entries.filter(([key]) => !creds[key]);
  const missingKeys = missing.map(([key]) => key);
  if (missingKeys.length > 0) {
    const msg = `Missing credential: ${missingKeys[0]}`;
    return fail(ScraperErrorTypes.Generic, msg);
  }
  return succeed(true);
}

/**
 * Reduce one field fill onto the accumulator promise.
 * @param args - Bundled fill-from-discovery arguments.
 * @param acc - Running accumulator promise.
 * @param entry - Map entry [key, target].
 * @returns Updated accumulator.
 */
function reduceDiscoveryFill(
  args: IFillFromDiscoveryArgs,
  acc: Promise<Procedure<boolean>>,
  entry: readonly [string, IResolvedTarget],
): Promise<Procedure<boolean>> {
  const [key, target] = entry;
  return acc.then(prev => {
    if (!prev.success) return prev;
    const value = args.creds[key];
    return fillOneDiscoveryField({ executor: args.executor, target, value, logger: args.logger });
  });
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
  const initialResult = succeed(true);
  const seed: Promise<Procedure<boolean>> = Promise.resolve(initialResult);
  return entries.reduce(
    (acc: Promise<Procedure<boolean>>, entry): Promise<Procedure<boolean>> =>
      reduceDiscoveryFill(args, acc, entry),
    seed,
  );
}

/**
 * Try pressing Enter via sealed executor.
 * @param executor - Sealed action mediator.
 * @param activeFrameId - Opaque contextId of the frame with fields.
 * @param logger - Pipeline logger.
 * @returns True if Enter was pressed.
 */
async function tryEnterFromDiscovery(
  executor: IActionMediator,
  activeFrameId: string,
  logger: ScraperLogger,
): Promise<boolean> {
  logger.debug({ method: 'enter', url: maskVisibleText(activeFrameId) });
  await executor.pressEnter(activeFrameId).catch((): false => false);
  return true;
}

/**
 * Try clicking the submit button via sealed executor using pre-resolved target.
 * @param executor - Sealed action mediator.
 * @param discovery - Login field discovery with optional submit target.
 * @param logger - Pipeline logger.
 * @returns True if submit was clicked.
 */
async function tryClickSubmitFromDiscovery(
  executor: IActionMediator,
  discovery: ILoginFieldDiscovery,
  logger: ScraperLogger,
): Promise<boolean> {
  if (!discovery.submitTarget.has) return false;
  const target = discovery.submitTarget.value;
  const masked = maskVisibleText(target.candidateValue);
  logger.debug({ method: 'click', url: masked });
  await executor
    .clickElement({ contextId: target.contextId, selector: target.selector })
    .catch((): false => false);
  return true;
}

/**
 * Fill from PRE-resolved field discovery + submit via sealed executor.
 * No field resolution in ACTION — all targets come from PRE discovery.
 * @param args - Bundled fill-from-discovery arguments.
 * @returns Procedure with ISubmitResult.
 */
async function fillFromDiscovery(args: IFillFromDiscoveryArgs): Promise<Procedure<ISubmitResult>> {
  const { executor, logger, discovery } = args;
  const count = String(discovery.targets.size);
  logger.debug({ message: `filling ${count} fields` });
  const validation = validateCredentials(args.config.fields, args.creds);
  if (!validation.success) return validation;
  const fillResult = await fillFieldsFromDiscovery(args);
  if (!fillResult.success) return fillResult;
  const didEnter = await tryEnterFromDiscovery(executor, discovery.activeFrameId, logger);
  const didClick = await tryClickSubmitFromDiscovery(executor, discovery, logger);
  const method = resolveSubmitMethod(didEnter, didClick);
  const currentUrl = executor.getCurrentUrl();
  const maskedUrl = maskVisibleText(currentUrl);
  logger.debug({ method, url: maskedUrl });
  return succeed({ success: true, method });
}

export type { IFillFromDiscoveryArgs, ISubmitResult, SubmitMethod };
export { fillAllFields, fillAndSubmit, fillFromDiscovery };
