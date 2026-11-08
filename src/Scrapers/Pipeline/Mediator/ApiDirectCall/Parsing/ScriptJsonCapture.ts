/**
 * Selects a root field from serialized JSON in active script syntax.
 */

import { ScraperErrorTypes } from '../../../../Base/ErrorTypes.js';
import type { Procedure } from '../../../Types/Procedure.js';
import { fail, succeed } from '../../../Types/Procedure.js';
import { activeElements, attribute, isExecutableScript, scriptText } from './ActiveHtml.js';
import { hasDuplicateJsonField } from './JsonUnique.js';
import { scriptJsonLiterals } from './ScriptJsonExpressions.js';

interface IScriptJsonInput {
  readonly html: string;
  readonly field: string;
  readonly pattern: string;
  readonly maxChars: number;
}

/**
 * Reads a string field from a parsed JSON object.
 * @param parsed - Parsed JSON value.
 * @param field - Exact root field.
 * @returns Its string value, or false if unavailable.
 */
function rootField(parsed: unknown, field: string): string | false {
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return false;
  if (!Object.hasOwn(parsed, field)) return false;
  const value: unknown = Reflect.get(parsed, field);
  return typeof value === 'string' ? value : false;
}

/**
 * Refuses malformed JSON while preserving unexpected failures.
 * @param error - Parsing error.
 * @returns False for invalid JSON.
 */
function jsonFailure(error: unknown): false {
  if (error instanceof SyntaxError) return false;
  throw error;
}

/**
 * Refuses ambiguous root keys before returning a parsed value.
 * @param text - Serialized object.
 * @param field - Exact root field.
 * @param value - Parsed value or absence.
 * @returns The unambiguous value or absence.
 */
function uniqueValue(text: string, field: string, value: string | false): string | false {
  if (hasDuplicateJsonField(text, field)) throw new RangeError('duplicate JSON key');
  return value;
}

/**
 * Reads a field of an object serialized as JSON.
 * @param text - A JavaScript literal's decoded contents.
 * @param field - Exact root field.
 * @returns Its string value, or false if unavailable.
 */
function fieldOf(text: string, field: string): string | false {
  if (!text.trimStart().startsWith('{')) return false;
  try {
    const parsed: unknown = JSON.parse(text);
    const value = rootField(parsed, field);
    return uniqueValue(text, field, value);
  } catch (error) {
    return jsonFailure(error);
  }
}

/**
 * Whether a value passes the configured length and pattern.
 * @param value - Root field value, or false.
 * @param input - Capture policy.
 * @param pattern - Validated value pattern.
 * @returns True for a matching string.
 */
function isValidValue(
  value: string | false,
  input: IScriptJsonInput,
  pattern: RegExp,
): value is string {
  return (
    value !== false && value.length > 0 && value.length <= input.maxChars && pattern.test(value)
  );
}

/**
 * Reads valid values from active inline scripts.
 * @param input - Page and configured field policy.
 * @returns Distinct field values passing the bounds and pattern.
 */
function valuesOf(input: IScriptJsonInput): readonly string[] {
  const scripts = activeElements(input.html).filter(isExecutableScript);
  const inline = scripts.filter(node => attribute(node, 'src') === false);
  const texts = inline.map(scriptText);
  const literals = texts.flatMap(scriptJsonLiterals);
  const values = literals.map(text => fieldOf(text, input.field));
  const pattern = new RegExp(input.pattern, 'u');
  const valid = values.filter((value): value is string => isValidValue(value, input, pattern));
  return [...new Set(valid)];
}

/**
 * Selects the only valid value.
 * @param input - Page and configured field policy.
 * @returns The unique value or a refusal.
 */
function selectValue(input: IScriptJsonInput): Procedure<string> {
  const values = valuesOf(input);
  if (values.length === 1) return succeed(values[0]);
  return fail(ScraperErrorTypes.Generic, 'script JSON field missing or ambiguous');
}

/**
 * Refuses invalid script syntax without exposing its contents.
 * @param error - Parsing error.
 * @returns Value-free syntax failure.
 */
function scriptFailure(error: unknown): Procedure<string> {
  if (!(error instanceof SyntaxError || error instanceof RangeError)) throw error;
  return fail(ScraperErrorTypes.Generic, 'script JSON invalid');
}

/**
 * Selects one validated value without executing the page.
 * @param input - Page, field, pattern and bound.
 * @returns Its unique value or a value-free refusal.
 */
function captureScriptJson(input: IScriptJsonInput): Procedure<string> {
  try {
    return selectValue(input);
  } catch (error) {
    return scriptFailure(error);
  }
}

export default captureScriptJson;
export { captureScriptJson };
