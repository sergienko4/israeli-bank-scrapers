/**
 * Answer-classifier captures (N50). A matched case writes each capture's slot:
 * by default text of 1..`maxChars` chars with no control char; with `onlyKey`
 * the one key of an object; with `integer` a safe JSON integer in range, as
 * decimal text, under the same text rule. A capture whose pointer misses fails
 * `<step> answer capture <slot> missing`, any other refusal `… invalid`; no
 * value is named.
 *
 * Zero bank knowledge. Rule #11 compliant.
 */

import { ScraperErrorTypes } from '../../../../Base/ErrorTypes.js';
import type { IProcedureFailure, Procedure } from '../../../Types/Procedure.js';
import { fail, isOk, succeed } from '../../../Types/Procedure.js';
import type { IAnswerCapture, IAnswerCase, IAnswerRange } from '../ConfigContracts/index.js';
import { isPlainObject } from '../Envelope/JsonPointer.js';
import { isSafeText, resolveFirst } from './RunStep.classify.checks.js';
import type { CarryMap, JsonValue } from './RunStep.types.js';

/** One capture: its carry slot and its config. */
type CaptureEntry = readonly [string, IAnswerCapture];

/** What a capture reads from: the step's name and its opened answer. */
interface ICaptureInput {
  readonly stepName: string;
  readonly resp: JsonValue;
}

/**
 * The one key of an object.
 * @param value - Resolved value.
 * @returns The key, or false unless the value is an object of exactly one key.
 */
function onlyKeyOf(value: JsonValue): string | false {
  if (!isPlainObject(value)) return false;
  const keys = Object.keys(value);
  return keys.length === 1 ? keys[0] : false;
}

/**
 * A safe JSON integer in range, as decimal text.
 * @param value - Resolved value.
 * @param range - Inclusive range.
 * @returns The text, or false for any other value.
 */
function integerOf(value: JsonValue, range: IAnswerRange): string | false {
  if (typeof value !== 'number' || !Number.isSafeInteger(value)) return false;
  if (value < range.min || value > range.max) return false;
  return String(value);
}

/**
 * The text a capture takes from its resolved value.
 * @param value - Resolved value.
 * @param capture - The capture.
 * @returns The text, or false when the value has the wrong form.
 */
function captureText(value: JsonValue, capture: IAnswerCapture): string | false {
  if (capture.onlyKey === true) return onlyKeyOf(value);
  if (capture.integer !== undefined) return integerOf(value, capture.integer);
  return typeof value === 'string' ? value : false;
}

/**
 * Refuse one capture.
 * @param input - Step name and answer.
 * @param slot - Carry slot.
 * @param reason - `missing` or `invalid`.
 * @returns The refusal, naming no value.
 */
function refuse(input: ICaptureInput, slot: string, reason: string): Procedure<CarryMap> {
  return fail(ScraperErrorTypes.Generic, `${input.stepName} answer capture ${slot} ${reason}`);
}

/**
 * Read one capture.
 * @param input - Step name and answer.
 * @param entry - The slot and its capture.
 * @returns The slot's text, or the refusal.
 */
function readCapture(input: ICaptureInput, entry: CaptureEntry): Procedure<CarryMap> {
  const [slot, capture] = entry;
  const found = resolveFirst(input.resp, capture.pointer);
  if (!isOk(found)) return refuse(input, slot, 'missing');
  const text = captureText(found.value, capture);
  if (text === false || !isSafeText(text, capture.maxChars)) return refuse(input, slot, 'invalid');
  return succeed({ [slot]: text });
}

/**
 * Whether a capture verdict is a refusal.
 * @param verdict - One capture's verdict.
 * @returns True when the capture was refused.
 */
function isRefused(verdict: Procedure<CarryMap>): verdict is IProcedureFailure {
  return !isOk(verdict);
}

/**
 * Read a matched case's captures.
 * @param input - Step name and answer.
 * @param matched - The matched case.
 * @returns The captured slots, or the first refusal.
 */
function readCaptures(input: ICaptureInput, matched: IAnswerCase): Procedure<CarryMap> {
  const entries: readonly CaptureEntry[] = Object.entries(matched.captures ?? {});
  const verdicts = entries.map(entry => readCapture(input, entry));
  const refused = verdicts.find(isRefused);
  if (refused) return refused;
  const slots = verdicts.filter(isOk).map(verdict => verdict.value);
  const captured = slots.reduce<CarryMap>((carry, slot) => ({ ...carry, ...slot }), {});
  return succeed(captured);
}

export type { ICaptureInput };
export { readCaptures };
