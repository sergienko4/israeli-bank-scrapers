/**
 * Login form actions — fill fields + click submit via mediator.
 * Password resolves first (universal anchor), then others scope from it.
 * Submit clicks in the SAME frame where fields were filled.
 * All WK + DOM logic via mediator black box.
 */

import type { Frame, Page } from 'playwright-core';

import type { SelectorCandidate } from '../../../Base/Config/LoginConfigTypes.js';
import type { IFieldConfig } from '../../../Base/Interfaces/Config/FieldConfig.js';
import type { ILoginConfig } from '../../../Base/Interfaces/Config/LoginConfig.js';
import { reduceField, validateCredentials } from '../../Phases/Login/LoginFillStep.js';
import type { ScraperLogger } from '../../Types/Debug.js';
import { maskVisibleText } from '../../Types/LogEvent.js';
import type { Procedure } from '../../Types/Procedure.js';
import { succeed } from '../../Types/Procedure.js';
import type { IElementMediator } from '../Elements/ElementMediator.js';
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
  logger.debug({ event: 'login-submit', method: 'enter', url: maskVisibleText(url) });
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
  logger.debug({ event: 'login-submit', method: 'click', url: masked });
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
  logger.debug({ event: 'generic-trace', phase: 'LOGIN', message: `filling ${count} fields` });
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
  logger.debug({ event: 'login-submit', method, url: maskedUrl });
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

export type { ISubmitResult, SubmitMethod };
export { fillAllFields, fillAndSubmit };
