/**
 * Login scope helpers — discover form scope, fill fields, update scope.
 * Extracted from LoginFillStep.ts to respect max-lines.
 */

import type { Frame, Page } from 'playwright-core';

import type { IFieldConfig } from '../../Base/Interfaces/Config/FieldConfig.js';
import type { IElementMediator } from '../Mediator/Elements/ElementMediator.js';
import {
  fillOneField,
  type IFillFieldOpts,
  type IFillOpts,
  type IFillResult,
} from '../Phases/Login/LoginFillStep.js';
import type { Procedure } from '../Types/Procedure.js';
import { succeed } from '../Types/Procedure.js';

type FormSelector = string;

interface IFieldScope {
  readonly ctx?: Page | Frame;
  readonly formSelector?: FormSelector;
}

interface IFillAccum {
  readonly scope: IFieldScope;
  readonly procedure: Procedure<boolean>;
}

interface IFillContext {
  readonly mediator: IElementMediator;
  readonly creds: Record<string, string>;
}

interface IScopeUpdateArgs {
  readonly ctx: IFillContext;
  readonly field: IFieldConfig;
  readonly result: IFillResult;
}

/**
 * Build full fill-field options from config and scope.
 * @param ctx - Fill context.
 * @param field - Field config.
 * @param scope - Current scope.
 * @returns Fill field options ready for fillOneField.
 */
function buildFieldOpts(
  ctx: IFillContext,
  field: IFieldConfig,
  scope: IFieldScope,
): IFillFieldOpts {
  const key = field.credentialKey;
  const fill: IFillOpts = { credentialKey: key, value: ctx.creds[key], selectors: field.selectors };
  return {
    mediator: ctx.mediator,
    fill,
    scopeContext: scope.ctx,
    formSelector: scope.formSelector,
  };
}

/**
 * Discover form anchor and return updated scope.
 * @param ctx - Fill context.
 * @param field - Field config just resolved.
 * @param scope - Current scope.
 * @returns Updated scope with form selector.
 */
async function discoverScope(
  ctx: IFillContext,
  field: IFieldConfig,
  scope: IFieldScope,
): Promise<IFieldScope> {
  const resolved = await ctx.mediator.resolveField(field.credentialKey, field.selectors, scope.ctx);
  if (!resolved.success) return scope;
  const anchor = await ctx.mediator.discoverForm(resolved.value);
  if (!anchor.has) return scope;
  return { ...scope, formSelector: anchor.value.selector };
}

/**
 * Update scope after a successful field fill.
 * @param scope - Current scope.
 * @param args - Fill context, field, and result.
 * @returns Updated accumulator.
 */
async function updateScopeAfterFill(
  scope: IFieldScope,
  args: IScopeUpdateArgs,
): Promise<IFillAccum> {
  if (scope.ctx || !args.result.resolvedContext) return { scope, procedure: succeed(true) };
  let nextScope: IFieldScope = { ...scope, ctx: args.result.resolvedContext };
  nextScope = await discoverScope(args.ctx, args.field, nextScope);
  return { scope: nextScope, procedure: succeed(true) };
}

/**
 * Fill one field and update scope.
 * @param ctx - Fill context.
 * @param field - Field config.
 * @param scope - Current scope.
 * @returns Updated scope and procedure result.
 */
async function fillFieldStep(
  ctx: IFillContext,
  field: IFieldConfig,
  scope: IFieldScope,
): Promise<IFillAccum> {
  const opts = buildFieldOpts(ctx, field, scope);
  const result = await fillOneField(opts);
  if (!result.isOk) return { scope, procedure: result.procedure };
  return updateScopeAfterFill(scope, { ctx, field, result });
}

export { fillFieldStep };
export type { IFieldScope, IFillAccum, IFillContext };
