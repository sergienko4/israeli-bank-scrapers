/**
 * Form-body guard (N9) — a form step's hydrated body must be a flat record of
 * strings, finite numbers and booleans. Anything else fails the step before
 * its request, and the failure names no value.
 */

import { ScraperErrorTypes } from '../../../../Base/ErrorTypes.js';
import type { Procedure } from '../../../Types/Procedure.js';
import { fail, succeed } from '../../../Types/Procedure.js';
import type { IPreparedBody, IStepConfig } from './RunStep.types.js';

/**
 * Whether a value can travel as one form field.
 * @param value - Hydrated field value.
 * @returns True for a string, a finite number or a boolean.
 */
function isFormScalar(value: unknown): boolean {
  if (typeof value === 'string' || typeof value === 'boolean') return true;
  return typeof value === 'number' && Number.isFinite(value);
}

/**
 * Whether a hydrated body is a record of form scalars.
 * @param body - Hydrated body.
 * @returns True when every own value is a form scalar.
 */
function isFlatRecord(body: unknown): boolean {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) return false;
  return Object.values(body).every(isFormScalar);
}

/**
 * Pass a prepared body on, unless the step sends a form its body cannot fill.
 * @param step - Step config.
 * @param prepared - Prepared body.
 * @returns The prepared body, or `"<step> form body not flat"`.
 */
function guardFormBody(step: IStepConfig, prepared: IPreparedBody): Procedure<IPreparedBody> {
  if (step.encoding !== 'form') return succeed(prepared);
  if (isFlatRecord(prepared.body)) return succeed(prepared);
  return fail(ScraperErrorTypes.Generic, `${step.name} form body not flat`);
}

export default guardFormBody;
export { guardFormBody };
