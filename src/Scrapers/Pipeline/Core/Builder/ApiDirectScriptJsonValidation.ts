/**
 * Validates serialized JSON capture settings before any request.
 */

import { isBadCharCap } from './ApiDirectRuleInput.js';
import { isBadRegex, isFlatPattern } from './FlatPattern.js';

/**
 * Whether the field and length bound are usable.
 * @param capture - Untrusted capture configuration.
 * @returns True for a named field and bounded maximum.
 */
function hasFieldAndBound(capture: object): boolean {
  const field: unknown = Reflect.get(capture, 'field');
  const max: unknown = Reflect.get(capture, 'maxChars');
  return (
    typeof field === 'string' &&
    field.trim() !== '' &&
    typeof max === 'number' &&
    !isBadCharCap(max)
  );
}

/**
 * Whether the configured value pattern is safe and anchored.
 * @param capture - Untrusted capture configuration.
 * @returns True for a compiling flat pattern.
 */
function hasSafePattern(capture: object): boolean {
  const pattern: unknown = Reflect.get(capture, 'pattern');
  return typeof pattern === 'string' && !isBadRegex(pattern) && isFlatPattern(pattern);
}

/**
 * Validates one serialized-JSON capture.
 * @param capture - Untrusted capture configuration.
 * @returns True for a usable field, bound and pattern.
 */
function isScriptJsonCaptureValid(capture: object): boolean {
  return hasFieldAndBound(capture) && hasSafePattern(capture);
}

export default isScriptJsonCaptureValid;
export { isScriptJsonCaptureValid };
