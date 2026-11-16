/**
 * Step bank-error guard. Some banks answer a failed step with HTTP 200
 * and an error field. A step that declares `failIfPresent` has those body
 * pointers checked right after the body is parsed, before its outcome and its
 * extracts: any present, truthy value fails the step with its `bankErrorType`
 * (Generic when unset), whatever the outcome's default. Null, false, 0, ''
 * and empty arrays or records are not errors. The failure never echoes the
 * bank's value; the envelope codec fails a bank `error_code` the same way.
 */

import { ScraperErrorTypes } from '../../../../../Base/ErrorTypes.js';
import type { IProcedureFailure, Procedure } from '../../../../Types/Procedure.js';
import { fail, isOk, succeed } from '../../../../Types/Procedure.js';
import type { IStepConfig } from '../../ConfigContracts/index.js';
import type { JsonValue } from '../../Envelope/JsonPointer.js';
import { walkPointer } from '../../Envelope/JsonPointer.js';

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
 * Read a value as a bank error code.
 * @param value - Value found at a code pointer.
 * @returns The code text, or empty when the value is not a string or finite number.
 */
function asCode(value: JsonValue): string {
  if (typeof value === 'string') return value;
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  return '';
}

/**
 * Read the code at one pointer.
 * @param resp - Parsed response body.
 * @param pointer - Code pointer.
 * @returns The code text, or empty when the pointer does not resolve.
 */
function codeAt(resp: JsonValue, pointer: string): string {
  const walked = walkPointer(resp, pointer);
  return isOk(walked) ? asCode(walked.value) : '';
}

/**
 * Read the first bank error code named by the step's code pointers.
 * @param resp - Parsed response body.
 * @param pointers - Code pointers, checked in order.
 * @returns The first code text, or empty when none resolves.
 */
function firstCode(resp: JsonValue, pointers: readonly string[]): string {
  const codes = pointers.map((pointer): string => codeAt(resp, pointer));
  return codes.find((code): boolean => code !== '') ?? '';
}

/**
 * Read a mapped type for a code, ignoring inherited object properties.
 * @param map - The step's code map, when it has one.
 * @param code - Bank error code.
 * @returns The mapped type, or false for an unknown code.
 */
function mappedType(
  map: Readonly<Record<string, ScraperErrorTypes>> | false,
  code: string,
): ScraperErrorTypes | false {
  if (map === false) return false;
  if (!Object.hasOwn(map, code)) return false;
  return map[code];
}

/**
 * The failure a step fails with when its answer reports a bank error.
 * @param step - The step that answered.
 * @param resp - Parsed response body, when it holds the bank's code.
 * @returns A `<step> bank error` of the mapped type, naming no value.
 */
function bankErrorOf(step: IStepConfig, resp?: JsonValue): IProcedureFailure {
  const code = resp === undefined ? '' : firstCode(resp, step.bankErrorCodePointers ?? []);
  const mapped = code === '' ? false : mappedType(step.bankErrorTypeByCode ?? false, code);
  const errorType = mapped === false ? (step.bankErrorType ?? ScraperErrorTypes.Generic) : mapped;
  return fail(errorType, `${step.name} bank error`);
}

/**
 * Guard a step's 2xx body against bank errors, if it declares a guard.
 * @param step - The step that just answered.
 * @param resp - Parsed 2xx response body.
 * @returns Success, or a `<step> bank error` naming no value.
 */
function guardBankError(step: IStepConfig, resp: JsonValue): Procedure<true> {
  const pointers = step.failIfPresent ?? [];
  const isBankError = pointers.some((pointer): boolean => isErrorAt(resp, pointer));
  if (!isBankError) return succeed(true);
  return bankErrorOf(step, resp);
}

export { bankErrorOf, guardBankError };
