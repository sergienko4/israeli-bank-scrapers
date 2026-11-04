/**
 * Form-body guard (N9) — a form step's hydrated body must be a flat record of
 * strings, finite numbers and booleans. Anything else fails the step before
 * its request, and the failure names no value.
 */

import { ScraperErrorTypes } from '../../../../Base/ErrorTypes.js';
import { isFlatFormBody } from '../../../Strategy/Fetch/PostBody.js';
import type { Procedure } from '../../../Types/Procedure.js';
import { fail, succeed } from '../../../Types/Procedure.js';
import type { IPreparedBody, IStepConfig } from './RunStep.types.js';

/**
 * Pass a prepared body on, unless the step sends a form its body cannot fill.
 * @param step - Step config.
 * @param prepared - Prepared body.
 * @returns The prepared body, or `"<step> form body not flat"`.
 */
function guardFormBody(step: IStepConfig, prepared: IPreparedBody): Procedure<IPreparedBody> {
  if (step.encoding !== 'form') return succeed(prepared);
  if (isFlatFormBody(prepared.body)) return succeed(prepared);
  return fail(ScraperErrorTypes.Generic, `${step.name} form body not flat`);
}

export default guardFormBody;
export { guardFormBody };
