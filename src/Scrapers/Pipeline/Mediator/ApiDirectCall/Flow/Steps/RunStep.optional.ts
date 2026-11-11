/**
 * Optional extracts — carry slots a response may omit. A slot is written only
 * when its pointer resolves to a string that is not blank, so a blank or
 * whitespace-only field never overwrites an earlier value. A `keepExisting`
 * slot is written only while carry holds no non-empty string for it;
 * a different answer is logged by step and slot, never by value.
 */

import { getDebug } from '../../../../Logging/Debug.js';
import { isOk } from '../../../../Types/Procedure.js';
import type { IOptionalExtract, IStepConfig } from '../../ConfigContracts/index.js';
import { walkPointer } from '../../Envelope/JsonPointer.js';
import type { CarryMap, JsonValue } from './RunStep.types.js';

const LOG = getDebug(import.meta.url);

/** One optional slot: its carry name and how to read it. */
type OptionalEntry = readonly [string, IOptionalExtract];

/** Boxed raw value; false is a valid response value. */
interface IOptionalRaw {
  readonly kept: JsonValue;
}

/** What every slot of one step is read against. */
interface IOptionalFold {
  readonly resp: JsonValue;
  readonly stepName: string;
  /** Carry before the step's answer. */
  readonly prior: CarryMap;
}

/**
 * Read a present, nonblank optional field before a fallback can hide it.
 * @param resp - Response JSON.
 * @param pointer - RFC-6901 pointer.
 * @returns The raw value, or false when absent, null or blank.
 */
function optionalRawValue(resp: JsonValue, pointer: string): IOptionalRaw | false {
  const walked = walkPointer(resp, pointer);
  if (!isOk(walked) || walked.value === null) return false;
  if (typeof walked.value === 'string' && walked.value.trim() === '') return false;
  return { kept: walked.value };
}

/**
 * Read a string that is not blank at a pointer, as it is.
 * @param resp - Response JSON.
 * @param pointer - RFC-6901 pointer.
 * @returns The string, or false when absent, blank or not a string.
 */
function presentText(resp: JsonValue, pointer: string): string | false {
  const raw = optionalRawValue(resp, pointer);
  return raw !== false && typeof raw.kept === 'string' ? raw.kept : false;
}

/**
 * Note a slot kept against a different answer, by step and slot only.
 * @param fold - Step answer and prior carry.
 * @param slot - Carry slot name.
 * @returns Sentinel true.
 */
function logKept(fold: IOptionalFold, slot: string): true {
  LOG.debug({ step: fold.stepName, slot, kept: true, message: 'optional slot kept' });
  return true;
}

/**
 * Whether a `keepExisting` slot keeps the non-empty string carry holds.
 * @param fold - Step answer and prior carry.
 * @param entry - Slot name and extract rule.
 * @param text - The answer's value, or false when absent.
 * @returns True when the slot is kept.
 */
function isKept(fold: IOptionalFold, entry: OptionalEntry, text: string | false): boolean {
  const [slot, extract] = entry;
  const held = fold.prior[slot];
  if (extract.keepExisting !== true || typeof held !== 'string' || held.length === 0) return false;
  if (text !== false && text !== held) logKept(fold, slot);
  return true;
}

/**
 * Fold one optional slot into the carry addition.
 * @param acc - Carry addition so far.
 * @param entry - Slot name and extract rule.
 * @param fold - Step answer and prior carry.
 * @returns The addition with the slot written, or unchanged to keep the slot.
 */
function absorbOptional(acc: CarryMap, entry: OptionalEntry, fold: IOptionalFold): CarryMap {
  const [slot, extract] = entry;
  const text = presentText(fold.resp, extract.pointer);
  if (isKept(fold, entry, text)) return acc;
  if (text !== false) return { ...acc, [slot]: text };
  if (extract.fallback === undefined) return acc;
  return { ...acc, [slot]: extract.fallback };
}

/**
 * Read the step's optional extracts from its response.
 * @param resp - Response JSON.
 * @param step - Step config.
 * @param prior - Carry before the step's answer.
 * @returns Carry addition holding only the slots to write.
 */
function extractOptional(resp: JsonValue, step: IStepConfig, prior: CarryMap): CarryMap {
  const entries = Object.entries(step.optionalExtractsToCarry ?? {});
  const fold: IOptionalFold = { resp, stepName: step.name, prior };
  const empty: CarryMap = {};
  return entries.reduce((acc, entry): CarryMap => absorbOptional(acc, entry, fold), empty);
}

export default extractOptional;
export { extractOptional, optionalRawValue };
