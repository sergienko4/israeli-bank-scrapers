/**
 * Answer-classifier checks (N50). A check reads the first of its pointer's
 * alternatives that resolves: `absent` passes only when none does, and every
 * other kind fails on a missing pointer. `equals` and `oneOf` compare with
 * `===`; `items` and `keys` count an array's items and an object's keys; text
 * is 1..`maxChars` chars with no C0 control char or DEL, and its `pattern`
 * must match it whole. A pattern that does not compile fails its check.
 * `negate` (N60) inverts a check's verdict, missing pointer included; a check
 * with no kind fails either way.
 *
 * Zero bank knowledge. Rule #11 compliant.
 */

import { ScraperErrorTypes } from '../../../../Base/ErrorTypes.js';
import type { Procedure } from '../../../Types/Procedure.js';
import { fail, isOk } from '../../../Types/Procedure.js';
import type { AnswerPointer, IAnswerCheck, IAnswerText } from '../ConfigContracts/index.js';
import { isPlainObject, walkPointer } from '../Envelope/JsonPointer.js';
import type { JsonValue } from './RunStep.types.js';

/** The check kinds that read a resolved value. */
type ValueKind = 'equals' | 'oneOf' | 'items' | 'keys' | 'text';

/** Whether a resolved value passes one kind of a check. */
type ValueCheck = (value: JsonValue, check: IAnswerCheck) => boolean;

/** Highest C0 control code unit. */
const LAST_C0 = 0x1f;

/** The DEL control code unit. */
const DEL = 0x7f;

/**
 * Read the first of a pointer's alternatives that resolves.
 * @param resp - Opened answer.
 * @param pointer - A pointer, or alternatives.
 * @returns The value, or a miss when no alternative resolves.
 */
function resolveFirst(resp: JsonValue, pointer: AnswerPointer): Procedure<JsonValue> {
  const alternatives = typeof pointer === 'string' ? [pointer] : pointer;
  const walks = alternatives.map(alternative => walkPointer(resp, alternative));
  return walks.find(isOk) ?? fail(ScraperErrorTypes.Generic, 'answer pointer missing');
}

/**
 * Whether one char is a C0 control char or DEL.
 * @param unit - One char.
 * @returns True for a control char.
 */
function isControlUnit(unit: string): boolean {
  const code = unit.codePointAt(0);
  return code !== undefined && (code <= LAST_C0 || code === DEL);
}

/**
 * Whether a value is text of 1..`maxChars` chars with no control char.
 * @param value - Resolved value.
 * @param maxChars - Longest text allowed.
 * @returns True for safe text.
 */
function isSafeText(value: JsonValue, maxChars: number): value is string {
  if (typeof value !== 'string' || value === '') return false;
  if (value.length > maxChars) return false;
  const units = Array.from(value);
  return !units.some(isControlUnit);
}

/**
 * Whether a pattern matches the whole text; a broken pattern never does. It
 * must compile alone first, so `a)|(?:b` cannot escape the wrapper.
 * @param text - Safe text.
 * @param pattern - Regex source.
 * @returns True on a whole match.
 */
function isWholeMatch(text: string, pattern: string): boolean {
  try {
    const alone = new RegExp(pattern, 'u');
    const whole = new RegExp(`^(?:${alone.source})$`, 'u');
    return whole.test(text);
  } catch {
    return false;
  }
}

/**
 * Whether a value passes a text check.
 * @param value - Resolved value.
 * @param text - The text check.
 * @returns True for safe text that matches the pattern, if any.
 */
function isTextPass(value: JsonValue, text: IAnswerText): boolean {
  if (!isSafeText(value, text.maxChars)) return false;
  return text.pattern === undefined || isWholeMatch(value, text.pattern);
}

/**
 * Whether a value is strictly the check's `equals`.
 * @param value - Resolved value.
 * @param check - The check.
 * @returns True on `===`.
 */
function isEqual(value: JsonValue, check: IAnswerCheck): boolean {
  return value === check.equals;
}

/**
 * Whether a string or number is listed in the check's `oneOf`.
 * @param value - Resolved value.
 * @param check - The check.
 * @returns True when listed.
 */
function isListed(value: JsonValue, check: IAnswerCheck): boolean {
  if (typeof value !== 'string' && typeof value !== 'number') return false;
  return check.oneOf?.includes(value) === true;
}

/**
 * Whether a value is an array of exactly the check's `items`.
 * @param value - Resolved value.
 * @param check - The check.
 * @returns True on the count.
 */
function hasItems(value: JsonValue, check: IAnswerCheck): boolean {
  return Array.isArray(value) && value.length === check.items;
}

/**
 * Whether a value is an object of exactly the check's `keys`.
 * @param value - Resolved value.
 * @param check - The check.
 * @returns True on the count.
 */
function hasKeys(value: JsonValue, check: IAnswerCheck): boolean {
  return isPlainObject(value) && Object.keys(value).length === check.keys;
}

/**
 * Whether a value passes the check's `text`.
 * @param value - Resolved value.
 * @param check - The check.
 * @returns True for matching safe text.
 */
function isTextKind(value: JsonValue, check: IAnswerCheck): boolean {
  return check.text !== undefined && isTextPass(value, check.text);
}

/** Each value kind's predicate; a kind runs only when its check holds it. */
const VALUE_CHECKS: Readonly<Record<ValueKind, ValueCheck>> = {
  equals: isEqual,
  oneOf: isListed,
  items: hasItems,
  keys: hasKeys,
  text: isTextKind,
};

/** The value kinds, in check order. */
const VALUE_KINDS = Object.keys(VALUE_CHECKS) as readonly ValueKind[];

/**
 * Whether a check names any kind.
 * @param check - The check.
 * @returns True when it holds `absent` or a value kind.
 */
function hasKind(check: IAnswerCheck): boolean {
  if (check.absent === true) return true;
  return VALUE_KINDS.some((kind): boolean => check[kind] !== undefined);
}

/**
 * Whether the answer holds what a check of some kind names, before `negate`.
 * @param resp - Opened answer.
 * @param check - A check of some kind.
 * @returns True when the check's kinds hold.
 */
function holdsCheck(resp: JsonValue, check: IAnswerCheck): boolean {
  const found = resolveFirst(resp, check.pointer);
  if (check.absent === true) return !isOk(found);
  if (!isOk(found)) return false;
  const kinds = VALUE_KINDS.filter((kind): boolean => check[kind] !== undefined);
  return kinds.every((kind): boolean => VALUE_CHECKS[kind](found.value, check));
}

/**
 * Whether the answer passes one check; `negate` inverts the verdict, and a
 * check with no kind never passes, negated or not.
 * @param resp - Opened answer.
 * @param check - The check.
 * @returns True when the check passes.
 */
function passesCheck(resp: JsonValue, check: IAnswerCheck): boolean {
  if (!hasKind(check)) return false;
  const isHeld = holdsCheck(resp, check);
  return isHeld !== (check.negate === true);
}

export { isSafeText, passesCheck, resolveFirst };
