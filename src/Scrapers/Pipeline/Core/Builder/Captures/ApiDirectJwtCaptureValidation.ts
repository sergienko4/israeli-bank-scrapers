/**
 * Validates issued-token claim bindings before a flow starts.
 */

import { isBadCharCap, isBodyPointer } from '../ApiDirectRuleInput.js';
import { isCookieRef } from '../Transport/ApiDirectCookieRules.js';

/**
 * Whether an untrusted value is a non-array record.
 * @param value - Candidate configuration.
 * @returns True for a record.
 */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Whether a claim slot names a valid body pointer and positive character cap.
 * @param pointer - Candidate JSON pointer.
 * @param maxChars - Candidate character ceiling.
 * @returns True when both pointer and character cap are valid.
 */
function isBoundedClaimPointer(pointer: unknown, maxChars: unknown): boolean {
  if (typeof pointer !== 'string' || !isBodyPointer(pointer)) return false;
  return typeof maxChars === 'number' && !isBadCharCap(maxChars);
}

/**
 * Whether a value names a bounded output field.
 * @param value - Candidate claim slot.
 * @returns True for a valid pointer and limit.
 */
function isClaimSlot(value: unknown): boolean {
  if (!isRecord(value)) return false;
  const { pointer, maxChars, rejectBlank } = value;
  if (!isBoundedClaimPointer(pointer, maxChars)) return false;
  return rejectBlank === undefined || rejectBlank === true;
}

/**
 * Whether each configured equality binds a pointer to a known reference.
 * @param value - Candidate assertions.
 * @returns True for at least one valid assertion.
 */
function isBindingMap(value: unknown): boolean {
  if (!isRecord(value)) return false;
  const entries = Object.entries(value);
  return (
    entries.length > 0 &&
    entries.every(([pointer, ref]) => isBodyPointer(pointer) && isCookieRef(ref))
  );
}

/**
 * Whether each configured output has a valid name and claim slot.
 * @param value - Candidate output map.
 * @param source - Token carry slot.
 * @returns True for valid, non-overlapping outputs.
 */
function isCaptureMap(value: unknown, source: string): boolean {
  if (!isRecord(value)) return false;
  return Object.entries(value).every(([slot, claim]) => {
    return slot.trim() !== '' && slot !== source && isClaimSlot(claim);
  });
}

/**
 * Whether a claim binding is safe to use at runtime.
 * @param capture - Candidate capture.
 * @returns True for a complete and bounded configuration.
 */
function isJwtClaimsCaptureValid(capture: object): boolean {
  const from: unknown = Reflect.get(capture, 'from');
  const max: unknown = Reflect.get(capture, 'maxTokenChars');
  if (typeof from !== 'string' || from.trim() === '') return false;
  if (typeof max !== 'number' || isBadCharCap(max)) return false;
  const bindings: unknown = Reflect.get(capture, 'equals');
  const outputs: unknown = Reflect.get(capture, 'captures');
  return isBindingMap(bindings) && isCaptureMap(outputs, from);
}

export default isJwtClaimsCaptureValid;
export { isJwtClaimsCaptureValid };
