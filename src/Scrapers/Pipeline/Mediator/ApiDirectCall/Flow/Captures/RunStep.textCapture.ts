/**
 * Text captures. A `text` step's `textCaptures` search its answer: each
 * pattern, compiled with the `g` flag, must match exactly once, and its slot
 * takes the named group's text — no match (or an unmatched group) fails
 * `<step> capture <slot> missing`, a second match `<step> capture <slot>
 * ambiguous`. An `absent` capture is a guard: any match fails `<step> capture
 * <slot> present`, and it carries nothing. The slot's `extractRules` then
 * check the text, with `maxChars` 8192 when it has none. No captured text is
 * logged; a failure names the slot only.
 */

import { ScraperErrorTypes } from '../../../../../Base/ErrorTypes.js';
import type { IProcedureFailure, Procedure } from '../../../../Types/Procedure.js';
import { fail, isOk, succeed } from '../../../../Types/Procedure.js';
import type { IStepConfig, ITextCapture } from '../../ConfigContracts/index.js';
import type { CarryMap, JsonValue } from '../Steps/RunStep.types.js';

/** One capture: its carry slot and its pattern. */
type CaptureEntry = readonly [string, ITextCapture];

/** Why a capture refused the answer. */
type CaptureReason = 'missing' | 'ambiguous' | 'present';

/** The answer text and the step that read it. */
interface ICaptureInput {
  readonly stepName: string;
  readonly text: string;
}

/**
 * The slots a step's captures write: every capture but the `absent` guards.
 * @param step - Step config.
 * @returns Carry slot names, in config order.
 */
function captureSlotsOf(step: IStepConfig): readonly string[] {
  const entries: readonly CaptureEntry[] = Object.entries(step.textCaptures ?? {});
  const carried = entries.filter(([, capture]): boolean => capture.absent !== true);
  return carried.map(([slot]): string => slot);
}

/**
 * The text of a `{ text }` answer.
 * @param resp - The step's answer.
 * @returns Its `text`, or '' when it holds none.
 */
function answerText(resp: JsonValue): string {
  if (typeof resp !== 'object' || resp === null || Array.isArray(resp)) return '';
  const text = (resp as Record<string, JsonValue>).text;
  return typeof text === 'string' ? text : '';
}

/**
 * Search a text for a pattern's first two matches; an empty match steps one
 * char on, so the second search moves.
 * @param text - Answer text.
 * @param pattern - Regex source.
 * @returns No, one or two matches.
 */
function firstTwoMatches(text: string, pattern: string): readonly RegExpExecArray[] {
  const search = new RegExp(pattern, 'g');
  const first = search.exec(text);
  if (first === null) return [];
  if (first[0] === '') search.lastIndex += 1;
  const second = search.exec(text);
  return second === null ? [first] : [first, second];
}

/**
 * Fail a capture, naming the step and the slot only.
 * @param input - The step that read the answer.
 * @param slot - Capture slot.
 * @param reason - Why it failed.
 * @returns Generic failure.
 */
function refuse(input: ICaptureInput, slot: string, reason: CaptureReason): IProcedureFailure {
  return fail(ScraperErrorTypes.Generic, `${input.stepName} capture ${slot} ${reason}`);
}

/**
 * Check an `absent` guard: its pattern must not match.
 * @param input - The answer text and its step.
 * @param slot - Guard slot.
 * @param found - The pattern's matches.
 * @returns {} when nothing matched, else the refusal.
 */
function guardAbsent(
  input: ICaptureInput,
  slot: string,
  found: readonly RegExpExecArray[],
): Procedure<CarryMap> {
  if (found.length === 0) return succeed({});
  return refuse(input, slot, 'present');
}

/**
 * Read one capture from the answer text.
 * @param input - The answer text and its step.
 * @param entry - The slot and its capture.
 * @returns The slot's text, {} for a passed guard, or the refusal.
 */
function captureOne(input: ICaptureInput, entry: CaptureEntry): Procedure<CarryMap> {
  const [slot, capture] = entry;
  const found = firstTwoMatches(input.text, capture.pattern);
  if (capture.absent === true) return guardAbsent(input, slot, found);
  if (found.length > 1) return refuse(input, slot, 'ambiguous');
  const value = found.at(0)?.[capture.group];
  if (value === undefined) return refuse(input, slot, 'missing');
  return succeed({ [slot]: value });
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
 * Read a step's captures from its `{ text }` answer.
 * @param step - Step config.
 * @param resp - The step's answer.
 * @returns The captured slots, or the first refusal.
 */
function captureText(step: IStepConfig, resp: JsonValue): Procedure<CarryMap> {
  const entries: readonly CaptureEntry[] = Object.entries(step.textCaptures ?? {});
  const input: ICaptureInput = { stepName: step.name, text: answerText(resp) };
  const verdicts = entries.map(entry => captureOne(input, entry));
  const refused = verdicts.find(isRefused);
  if (refused) return refused;
  const slots = verdicts.filter(isOk).map(verdict => verdict.value);
  const captured = slots.reduce<CarryMap>((carry, slot) => ({ ...carry, ...slot }), {});
  return succeed(captured);
}

export default captureText;
export { answerText, captureSlotsOf, captureText };
