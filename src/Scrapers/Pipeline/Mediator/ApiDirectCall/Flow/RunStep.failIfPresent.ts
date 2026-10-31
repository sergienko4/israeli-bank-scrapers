/**
 * Step bank-error guard (N20). Some banks answer a failed step with HTTP 200
 * and an error field. A step that declares `failIfPresent` has those body
 * pointers checked right after the body is parsed, before its outcome and its
 * extracts: any present, truthy value fails the step Generic, whatever the
 * outcome's default. Null, false, 0, '' and empty arrays or records are not
 * errors. The failure never echoes the bank's value.
 */

import { ScraperErrorTypes } from '../../../../Base/ErrorTypes.js';
import type { Procedure } from '../../../Types/Procedure.js';
import { fail, isOk, succeed } from '../../../Types/Procedure.js';
import type { IStepConfig } from '../ConfigContracts/index.js';
import type { JsonValue } from '../Envelope/JsonPointer.js';
import { walkPointer } from '../Envelope/JsonPointer.js';

/**
 * Whether a body value reports an error.
 * @param value - Value found at a guard pointer.
 * @returns True for a truthy scalar or a non-empty array or record.
 */
function isErrorValue(value: JsonValue): boolean {
  if (Array.isArray(value)) return value.length > 0;
  if (typeof value === 'object' && value !== null) return Object.keys(value).length > 0;
  return Boolean(value);
}

/**
 * Whether the body holds an error at one pointer.
 * @param resp - Parsed 2xx response body.
 * @param pointer - Guard pointer.
 * @returns True when the pointer resolves to an error value.
 */
function isErrorAt(resp: JsonValue, pointer: string): boolean {
  const walked = walkPointer(resp, pointer);
  return isOk(walked) && isErrorValue(walked.value);
}

/**
 * Guard a step's 2xx body against bank errors, if it declares a guard.
 * @param step - The step that just answered.
 * @param resp - Parsed 2xx response body.
 * @returns Success, or a Generic `<step> bank error` naming no value.
 */
function guardBankError(step: IStepConfig, resp: JsonValue): Procedure<true> {
  const pointers = step.failIfPresent ?? [];
  const isBankError = pointers.some((pointer): boolean => isErrorAt(resp, pointer));
  if (!isBankError) return succeed(true);
  return fail(ScraperErrorTypes.Generic, `${step.name} bank error`);
}

export default guardBankError;
export { guardBankError };
