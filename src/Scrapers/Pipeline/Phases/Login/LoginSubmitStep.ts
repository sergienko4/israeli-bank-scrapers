/**
 * Login submit helpers — click submit button via mediator.
 * Extracted from LoginFillStep.ts to respect max-lines.
 */

import type { Locator } from 'playwright-core';

import type { SelectorCandidate } from '../../../Base/Config/LoginConfigTypes.js';
import { ScraperErrorTypes } from '../../../Base/ErrorTypes.js';
import type { IFieldConfig } from '../../../Base/Interfaces/Config/FieldConfig.js';
import type { ILoginConfig } from '../../../Base/Interfaces/Config/LoginConfig.js';
import type { IElementMediator } from '../../Mediator/Elements/ElementMediator.js';
import { type IFillAccum, type IFillContext } from '../../Strategy/LoginScopeStep.js';
import { toErrorMessage } from '../../Types/ErrorUtils.js';
import type { IPipelineStep } from '../../Types/Phase.js';
import type { IPipelineContext } from '../../Types/PipelineContext.js';
import type { Procedure } from '../../Types/Procedure.js';
import { fail, succeed } from '../../Types/Procedure.js';
import { reduceField, validateCredentials } from './LoginFillStep.js';

/**
 * Normalize submit config to array.
 * @param submit - Single or array of candidates.
 * @returns Array of candidates.
 */
function normalizeSubmit(submit: ILoginConfig['submit']): readonly SelectorCandidate[] {
  if (Array.isArray(submit)) return submit;
  return [submit];
}

/**
 * Attempt to click a resolved locator.
 * @param locator - Playwright locator with first().click().
 * @returns Succeed or failure.
 */
async function tryClick(locator: Locator): Promise<Procedure<boolean>> {
  try {
    await locator.first().click();
    return succeed(true);
  } catch (err) {
    const msg = toErrorMessage(err as Error);
    return fail(ScraperErrorTypes.Generic, `Submit: ${msg}`);
  }
}

/**
 * Click the submit button via mediator.
 * @param mediator - Element mediator.
 * @param candidates - Submit button candidates.
 * @returns Succeed or failure Procedure.
 */
async function clickSubmit(
  mediator: IElementMediator,
  candidates: readonly SelectorCandidate[],
): Promise<Procedure<boolean>> {
  const result = await mediator.resolveAndClick(candidates);
  if (!result.success) return result;
  if (!result.value.locator) return succeed(true);
  return tryClick(result.value.locator);
}

/**
 * Fill fields and click submit with a validated mediator.
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
  const fillResult = await fillAllFields(mediator, config.fields, creds);
  if (!fillResult.success) return fillResult;
  const candidates = normalizeSubmit(config.submit);
  return clickSubmit(mediator, candidates);
}

/**
 * Execute the loginAction step body.
 * @param config - Bank's login config.
 * @param input - Context with login.activeFrame.
 * @returns Same context after filling + submitting.
 */
async function executeLoginAction(
  config: ILoginConfig,
  input: IPipelineContext,
): Promise<Procedure<IPipelineContext>> {
  if (!input.loginAreaReady) return fail(ScraperErrorTypes.Generic, 'gate: loginAreaReady=false');
  if (!input.login.has) return fail(ScraperErrorTypes.Generic, 'No login context');
  if (!input.mediator.has) return fail(ScraperErrorTypes.Generic, 'No mediator');
  const creds = input.credentials as Record<string, string>;
  const result = await fillAndSubmit(input.mediator.value, config, creds);
  if (!result.success) return result;
  return succeed(input);
}

/**
 * Fill all credential fields sequentially via mediator.
 * @param mediator - IElementMediator.
 * @param fields - Field configs.
 * @param creds - Credentials map.
 * @returns Procedure — fails if any field is not found.
 */
async function fillAllFields(
  mediator: IElementMediator,
  fields: ILoginConfig['fields'],
  creds: Record<string, string>,
): Promise<Procedure<boolean>> {
  const validation = validateCredentials(fields, creds);
  if (!validation.success) return validation;
  const ctx: IFillContext = { mediator, creds };
  const seed = Promise.resolve<IFillAccum>({ scope: {}, procedure: succeed(true) });
  const final = await fields.reduce(
    (p: Promise<IFillAccum>, f: IFieldConfig): Promise<IFillAccum> => reduceField(ctx, p, f),
    seed,
  );
  return final.procedure;
}

/**
 * Create the loginAction step.
 * @param config - Bank's login config.
 * @returns Pipeline step: fill fields + click submit.
 */
function createLoginActionStep(
  config: ILoginConfig,
): IPipelineStep<IPipelineContext, IPipelineContext> {
  /**
   * Execute login action delegate.
   * @param _c - Unused context.
   * @param i - Pipeline input.
   * @returns Login result.
   */
  const exec = async (
    _c: IPipelineContext,
    i: IPipelineContext,
  ): Promise<Procedure<IPipelineContext>> => await executeLoginAction(config, i);
  return { name: 'login-action', execute: exec };
}

export default executeLoginAction;
export { createLoginActionStep, executeLoginAction, fillAllFields };
