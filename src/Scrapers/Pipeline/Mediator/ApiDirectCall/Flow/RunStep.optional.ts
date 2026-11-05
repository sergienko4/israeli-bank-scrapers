/**
 * Optional extracts — carry slots a response may omit. A slot is written only
 * when its pointer resolves to a string that is not blank, so a blank or
 * whitespace-only field never overwrites a value an earlier step stored.
 */

import { isOk } from '../../../Types/Procedure.js';
import type { IOptionalExtract, IStepConfig } from '../ConfigContracts/index.js';
import { walkPointer } from '../Envelope/JsonPointer.js';
import type { CarryMap, JsonValue } from './RunStep.types.js';

/** One optional slot: its carry name and how to read it. */
type OptionalEntry = readonly [string, IOptionalExtract];

/** Boxed raw value; false is a valid response value. */
interface IOptionalRaw {
  readonly kept: JsonValue;
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
 * Fold one optional slot into the carry addition.
 * @param acc - Carry addition so far.
 * @param entry - Slot name and extract rule.
 * @param resp - Response JSON.
 * @returns The addition with the slot written, or unchanged to keep the slot.
 */
function absorbOptional(acc: CarryMap, entry: OptionalEntry, resp: JsonValue): CarryMap {
  const [slot, extract] = entry;
  const text = presentText(resp, extract.pointer);
  if (text !== false) return { ...acc, [slot]: text };
  if (extract.fallback === undefined) return acc;
  return { ...acc, [slot]: extract.fallback };
}

/**
 * Read the step's optional extracts from its response.
 * @param resp - Response JSON.
 * @param step - Step config.
 * @returns Carry addition holding only the slots to write.
 */
function extractOptional(resp: JsonValue, step: IStepConfig): CarryMap {
  const entries = Object.entries(step.optionalExtractsToCarry ?? {});
  const empty: CarryMap = {};
  return entries.reduce((acc, entry): CarryMap => absorbOptional(acc, entry, resp), empty);
}

export default extractOptional;
export { extractOptional, optionalRawValue };
