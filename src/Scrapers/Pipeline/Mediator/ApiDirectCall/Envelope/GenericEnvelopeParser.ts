/**
 * GenericEnvelopeParser — consumes IEnvelopeSelectors (bank-supplied
 * JSON-pointer map) to pluck named values from a response envelope.
 * Returns Procedure: success carries the plucked record, failure
 * surfaces the FIRST missing selector's name + path (deterministic
 * diagnostic).
 *
 * Rule #11 compliance: zero bank names. The parser is driven entirely
 * by the selector map passed at call time.
 */

import { ScraperErrorTypes } from '../../../../Base/ErrorTypes.js';
import type { Procedure } from '../../../Types/Procedure.js';
import { fail, isOk, succeed } from '../../../Types/Procedure.js';
import type { IEnvelopeSelectors } from '../IApiDirectCallConfig.js';
import type { JsonValue } from './JsonPointer.js';
import { walkPointer } from './JsonPointer.js';

/** Plucked record — arbitrary JSON-value shape, indexed by selector name. */
type ExtractedFields = Record<string, JsonValue>;

/**
 * Absorb one selector into the accumulator. Extracted to satisfy
 * max-depth 1; propagates the first miss as the final failure.
 * @param doc - Response envelope.
 * @param acc - Accumulated record so far.
 * @param entry - [selectorName, pointer] pair to resolve.
 * @returns Updated accumulator, or the first miss failure.
 */
function absorbSelector(
  doc: JsonValue,
  acc: Record<string, JsonValue>,
  entry: readonly [string, string],
): Procedure<Record<string, JsonValue>> {
  const [name, pointer] = entry;
  const walked = walkPointer(doc, pointer);
  if (!isOk(walked)) {
    return fail(ScraperErrorTypes.Generic, `envelope selector miss: ${name} at ${pointer}`);
  }
  acc[name] = walked.value;
  return succeed(acc);
}

/**
 * Reducer — short-circuits the accumulator once a miss is recorded.
 * @param doc - Envelope passed down through the reduction.
 * @param stepOutcome - Current accumulator (success or first miss).
 * @param entry - Next selector pair to absorb.
 * @returns Updated accumulator procedure.
 */
function reduceStep(
  doc: JsonValue,
  stepOutcome: Procedure<Record<string, JsonValue>>,
  entry: readonly [string, string],
): Procedure<Record<string, JsonValue>> {
  if (!isOk(stepOutcome)) return stepOutcome;
  return absorbSelector(doc, stepOutcome.value, entry);
}

/**
 * Extract every named selector from the envelope.
 * @param doc - Response envelope (parsed JSON).
 * @param selectors - Bank's selector map.
 * @returns Procedure<ExtractedFields> — fail on first missing selector.
 */
function extractFields(doc: JsonValue, selectors: IEnvelopeSelectors): Procedure<ExtractedFields> {
  const entries = Object.entries(selectors);
  const seed: Procedure<Record<string, JsonValue>> = succeed({});
  return entries.reduce<Procedure<Record<string, JsonValue>>>(
    (stepOutcome, entry) => reduceStep(doc, stepOutcome, entry),
    seed,
  );
}

export type { ExtractedFields };
export default extractFields;
export { extractFields };
