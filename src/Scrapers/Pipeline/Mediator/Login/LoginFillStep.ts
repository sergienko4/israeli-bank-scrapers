/**
 * Login field-fill helpers — resolves and fills credential fields via mediator.
 * Submit logic in LoginSubmitStep.ts, scope logic in LoginScopeStep.ts.
 */

import type { Frame, Page } from 'playwright-core';

import type { SelectorCandidate } from '../../../Base/Config/LoginConfigTypes.js';
import { ScraperErrorTypes } from '../../../Base/ErrorTypes.js';
import type { IFieldConfig } from '../../../Base/Interfaces/Config/FieldConfig.js';
import type { ILoginConfig } from '../../../Base/Interfaces/Config/LoginConfig.js';
import type { ScraperLogger } from '../../Types/Debug.js';
import { maskVisibleText } from '../../Types/LogEvent.js';
import type { Procedure } from '../../Types/Procedure.js';
import { fail, succeed } from '../../Types/Procedure.js';
import type { IElementMediator } from '../Elements/ElementMediator.js';
import { deepFillInput } from '../Elements/ElementsInteractions.js';
import { fillFieldStep, type IFillAccum, type IFillContext } from '../Form/LoginScopeResolver.js';
import type { IFieldContext } from '../Selector/SelectorResolverPipeline.js';

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
  readonly logger: ScraperLogger;
}

/** Whether fill succeeded. */
type IsFillOk = boolean;

/** Result of filling one field. */
export interface IFillResult {
  readonly isOk: IsFillOk;
  readonly procedure: Procedure<boolean>;
  readonly resolvedContext?: Page | Frame;
}

/** Lookup for resolve outcome labels. */
const RESOLVE_STATUS: Record<string, string> = { true: 'FOUND', false: 'NOT_FOUND' };

/**
 * Log field resolution intent and outcome.
 * @param log - Logger instance.
 * @param key - Credential key name.
 * @param success - Whether resolution succeeded.
 * @returns The success flag for chaining.
 */
function logResolveResult(log: ScraperLogger, key: CredentialKey, success: IsPresent): IsPresent {
  const status = RESOLVE_STATUS[String(success)];
  log.debug({ field: maskVisibleText(key), result: status });
  return success;
}

/**
 * Resolve a credential field via mediator, logging the outcome.
 * @param opts - Bundled fill options.
 * @returns Resolve result from the mediator.
 */
async function resolveCredentialField(opts: IFillFieldOpts): Promise<Procedure<IFieldContext>> {
  const key = opts.fill.credentialKey;
  const msg = `resolving ${maskVisibleText(key)}`;
  opts.logger.debug({ message: msg });
  const result = await opts.mediator.resolveField(
    key,
    opts.fill.selectors,
    opts.scopeContext,
    opts.formSelector,
  );
  logResolveResult(opts.logger, key, result.success);
  return result;
}

/**
 * Fill one credential field via mediator.
 * @param opts - Bundled fill options.
 * @returns Fill result with resolved context.
 */
export async function fillOneField(opts: IFillFieldOpts): Promise<IFillResult> {
  const result = await resolveCredentialField(opts);
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
