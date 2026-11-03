/**
 * Extract-rule JSON types. A rule's `type` is checked on the raw value
 * before any transform or text check: a string, a finite number, a record
 * (a non-null, non-array object) or a list. `null` is no type.
 */

import type { ExtractValueType, IExtractRule } from '../ConfigContracts/index.js';
import type { JsonValue } from './RunStep.types.js';

/** Whether a raw value has a demanded JSON type. */
type TypeCheck = (value: JsonValue) => boolean;

/**
 * Whether a value is a string.
 * @param value - Raw value.
 * @returns True for a string.
 */
function isText(value: JsonValue): boolean {
  return typeof value === 'string';
}

/**
 * Whether a value is a finite number.
 * @param value - Raw value.
 * @returns True for a finite number.
 */
function isFiniteNumber(value: JsonValue): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

/**
 * Whether a value is a record.
 * @param value - Raw value.
 * @returns True for a non-null, non-array object.
 */
function isRecord(value: JsonValue): boolean {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Whether a value is a list.
 * @param value - Raw value.
 * @returns True for an array.
 */
function isList(value: JsonValue): boolean {
  return Array.isArray(value);
}

const TYPE_CHECKS: Readonly<Record<ExtractValueType, TypeCheck>> = {
  string: isText,
  number: isFiniteNumber,
  object: isRecord,
  array: isList,
};

/**
 * Whether a raw value has the rule's JSON type.
 * @param value - Raw value.
 * @param rule - Extract rule.
 * @returns True when `type` is unset or matches.
 */
function isTypeSound(value: JsonValue, rule: IExtractRule): boolean {
  if (rule.type === undefined) return true;
  const isType = TYPE_CHECKS[rule.type];
  return isType(value);
}

export default isTypeSound;
export { isFiniteNumber, isTypeSound };
