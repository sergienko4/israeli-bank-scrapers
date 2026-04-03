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

/**
 * Fill all credential fields sequentially via mediator.
 * Returns the resolved frame scope for submit targeting.
 * @param mediator - IElementMediator.
 * @param fields - Field configs.
 * @param creds - Credentials map.
 * @returns Fill result with frame context.
 */
async function fillAllFields(
  mediator: IElementMediator,
  fields: ILoginConfig['fields'],
  creds: Record<string, string>,
): Promise<IFillAllResult> {
  const validation = validateCredentials(fields, creds);
  if (!validation.success) return { procedure: validation, frameContext: undefined };
  const ordered = passwordFirst(fields);
  const ctx: IFillContext = { mediator, creds };
  const seed = Promise.resolve<IFillAccum>({ scope: {}, procedure: succeed(true) });
  const final = await ordered.reduce(
    (p: Promise<IFillAccum>, f: IFieldConfig): Promise<IFillAccum> => reduceField(ctx, p, f),
    seed,
  );
  return { procedure: final.procedure, frameContext: final.scope.ctx };
}

/**
 * Try pressing Enter in the frame context to submit the form.
 * @param frameCtx - Page or Frame where fields were filled (false if none).
 * @returns True if Enter was pressed.
 */
async function tryEnterSubmit(frameCtx: Page | Frame | false): Promise<boolean> {
  if (!frameCtx || !('press' in frameCtx)) return false;
  const url = frameCtx.url().slice(0, 50);
  process.stderr.write(`    [LOGIN.ACTION] pressing Enter in ${url}\n`);
  await frameCtx.press('input', 'Enter').catch((): false => false);
  return true;
}

/**
 * Try clicking the submit button scoped to the discovered form.
 * @param mediator - Element mediator.
 * @param config - Login config.
 * @returns Procedure succeed(true) if clicked, succeed(false) if not found, fail on error.
 */
async function tryClickSubmit(
  mediator: IElementMediator,
  config: ILoginConfig,
): Promise<Procedure<boolean>> {
  const candidates = normalizeSubmit(config.submit);
  const scoped = mediator.scopeToForm(candidates);
  const result = await mediator.resolveAndClick(scoped);
  if (!result.success) return result;
  if (!result.value.found) return succeed(false);
  process.stderr.write(`    [LOGIN.ACTION] submit clicked: "${result.value.value}"\n`);
  return succeed(true);
}

/**
 * Fill fields then submit — Enter first, then Click.
 * Returns which method fired so POST knows what to validate.
 * @param mediator - Element mediator.
 * @param config - Login config.
 * @param creds - Credentials map.
 * @returns Procedure with ISubmitResult (method: enter|click|both).
 */
async function fillAndSubmit(
  mediator: IElementMediator,
  config: ILoginConfig,
  creds: Record<string, string>,
): Promise<Procedure<ISubmitResult>> {
  const count = String(config.fields.length);
  process.stderr.write(`    [LOGIN.ACTION] filling ${count} fields\n`);
  const fillResult = await fillAllFields(mediator, config.fields, creds);
  if (!fillResult.procedure.success) return fillResult.procedure;
  const enterCtx = fillResult.frameContext ?? false;
  const didEnter = await tryEnterSubmit(enterCtx);
  const clickResult = await tryClickSubmit(mediator, config);
  if (!clickResult.success && !didEnter) return clickResult;
  const didClick = clickResult.success && clickResult.value;
  const method = resolveSubmitMethod(didEnter, didClick);
  process.stderr.write(`    [LOGIN.ACTION] submit method: ${method}\n`);
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

export { fillAllFields, fillAndSubmit };
export type { ISubmitResult, SubmitMethod };
