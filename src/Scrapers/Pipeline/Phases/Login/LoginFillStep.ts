/**
 * Login field-fill helpers — resolves and fills credential fields via mediator.
 * Submit logic in LoginSubmitStep.ts, scope logic in LoginScopeStep.ts.
 */

import type { Frame, Page } from 'playwright-core';

import type { SelectorCandidate } from '../../../Base/Config/LoginConfigTypes.js';
import { ScraperErrorTypes } from '../../../Base/ErrorTypes.js';
import type { IFieldConfig } from '../../../Base/Interfaces/Config/FieldConfig.js';
import type { ILoginConfig } from '../../../Base/Interfaces/Config/LoginConfig.js';
import type { IElementMediator } from '../../Mediator/Elements/ElementMediator.js';
import { deepFillInput } from '../../Mediator/Elements/ElementsInteractions.js';
import {
  fillFieldStep,
  type IFillAccum,
  type IFillContext,
} from '../../Strategy/LoginScopeStep.js';
import type { Procedure } from '../../Types/Procedure.js';
import { fail, succeed } from '../../Types/Procedure.js';

type FormSelector = string;
/** Whether a credential key is present in the credentials map. */
type IsPresent = boolean;
/** A credential key name (e.g. 'username', 'password'). */
type CredentialKey = string;
/** A credential value (the user's input). */
type CredentialValue = string;

/** Options for filling a single credential field. */
export interface IFillOpts {
  readonly credentialKey: CredentialKey;
  readonly value: CredentialValue;
  readonly selectors: readonly SelectorCandidate[];
}

/** Bundled options for filling one field via mediator. */
export interface IFillFieldOpts {
  readonly mediator: IElementMediator;
  readonly fill: IFillOpts;
  readonly scopeContext?: Page | Frame;
  readonly formSelector?: FormSelector;
}

/** Whether fill succeeded. */
type IsFillOk = boolean;

/** Result of filling one field. */
export interface IFillResult {
  readonly isOk: IsFillOk;
  readonly procedure: Procedure<boolean>;
  readonly resolvedContext?: Page | Frame;
}

/**
 * Fill one credential field via mediator.
 * @param opts - Bundled fill options.
 * @returns Fill result with resolved context.
 */
export async function fillOneField(opts: IFillFieldOpts): Promise<IFillResult> {
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
 * Check if a credential is missing from the map.
 * @param fields - Field configs.
 * @param creds - Credentials map.
 * @returns Missing field keys.
 */
function findMissingKeys(
  fields: readonly IFieldConfig[],
  creds: Record<string, string>,
): readonly string[] {
  return fields
    .filter((f): IsPresent => !creds[f.credentialKey])
    .map((f): CredentialKey => f.credentialKey);
}

/**
 * Validate all required credentials are present.
 * @param fields - Field configs.
 * @param creds - Credentials map.
 * @returns Success or failure listing missing keys.
 */
function validateCredentials(
  fields: ILoginConfig['fields'],
  creds: Record<string, string>,
): Procedure<boolean> {
  const missing = findMissingKeys(fields, creds);
  if (missing.length > 0) {
    const keys = missing.join(', ');
    return fail(ScraperErrorTypes.Generic, `Missing credentials: ${keys}`);
  }
  return succeed(true);
}

/**
 * Reduce one field in the sequential fill chain.
 * @param ctx - Fill context.
 * @param prev - Previous accumulator promise.
 * @param field - Field config to fill.
 * @returns Updated accumulator.
 */
async function reduceField(
  ctx: IFillContext,
  prev: Promise<IFillAccum>,
  field: IFieldConfig,
): Promise<IFillAccum> {
  const acc = await prev;
  if (!acc.procedure.success) return acc;
  return await fillFieldStep(ctx, field, acc.scope);
}

export { reduceField, validateCredentials };
