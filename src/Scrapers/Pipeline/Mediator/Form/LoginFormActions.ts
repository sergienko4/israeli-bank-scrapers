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
 * Fill fields and click submit in the SAME frame context.
 * Scoping submit to the form's frame prevents clicking wrong-frame buttons.
 * @param mediator - Element mediator.
 * @param config - Login config.
 * @param creds - Credentials map.
 * @returns Procedure with boolean result.
 */
async function fillAndSubmit(
  mediator: IElementMediator,
  config: ILoginConfig,
  creds: Record<string, string>,
): Promise<Procedure<boolean>> {
  const count = String(config.fields.length);
  process.stderr.write(`    [LOGIN.ACTION] filling ${count} fields\n`);
  const fillResult = await fillAllFields(mediator, config.fields, creds);
  if (!fillResult.procedure.success) return fillResult.procedure;
  // Press Enter in the focused frame (iframe form submit)
  const frameCtx = fillResult.frameContext;
  if (frameCtx && 'press' in frameCtx) {
    process.stderr.write(`    [LOGIN.ACTION] pressing Enter in ${frameCtx.url().slice(0, 50)}\n`);
    await frameCtx.press('input', 'Enter').catch((): false => false);
  }
  const candidates = normalizeSubmit(config.submit);
  const submitResult = await mediator.resolveAndClick(candidates);
  if (!submitResult.success) return submitResult;
  process.stderr.write(`    [LOGIN.ACTION] submit clicked: "${submitResult.value.value}"\n`);
  return succeed(submitResult.value.found);
}

export { fillAllFields, fillAndSubmit };
