/**
 * Login credential validation + sequential field-fill reducer.
 * Field-level fill in LoginFieldFill.ts, scope logic in LoginScopeResolver.ts.
 */

import { ScraperErrorTypes } from '../../../Base/ErrorTypes.js';
import type { IFieldConfig } from '../../../Base/Interfaces/Config/FieldConfig.js';
import type { ILoginConfig } from '../../../Base/Interfaces/Config/LoginConfig.js';
import type { Procedure } from '../../Types/Procedure.js';
import { fail, succeed } from '../../Types/Procedure.js';
import { fillFieldStep, type IFillAccum, type IFillContext } from './LoginScopeResolver.js';

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
  return fields.filter((f): boolean => !creds[f.credentialKey]).map((f): string => f.credentialKey);
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
  return fillFieldStep(ctx, field, acc.scope);
}

export { reduceField, validateCredentials };
export type { IFillFieldOpts, IFillOpts, IFillResult } from './LoginFieldFill.js';
export { fillOneField } from './LoginFieldFill.js';
