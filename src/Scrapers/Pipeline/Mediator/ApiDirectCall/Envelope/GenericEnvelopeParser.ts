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

/**
 * Per-field length caps when surfacing the bank's error envelope in
 * the parser's `errorMessage`. The bank API itself does not embed
 * customer PII in these fields (verified for PayBox/Pepper/OneZero
 * — error envelopes carry only a stable error enum + a generic
 * human-readable description). Length caps keep the surfaced
 * envelope bounded for log readability; no PiiRedactor pass needed.
 */
const HINT_CODE_MAX_LEN = 32;
const HINT_NAME_MAX_LEN = 64;
const HINT_MESSAGE_MAX_LEN = 200;

/** Plucked record — arbitrary JSON-value shape, indexed by selector name. */
type ExtractedFields = Record<string, JsonValue>;

/**
 * Detect whether the response envelope looks like an error envelope
 * (object with at least one of `code` / `name` / `message` /
 * `explanation` as primitive), and produce a `[bank-error: ...]`
 * suffix surfacing the bank's reported error.
 *
 * <p>Reasoning: when the bank returns an error response, the
 * configured success-envelope JSON pointer (e.g. `/content/access_token`)
 * will not resolve. Without this sniff the only signal is "selector miss",
 * which forces the operator to re-run with PII_REDACTION=off to see
 * what the bank actually said. Surfacing the error fields turns the
 * runStep error message into a one-line diagnosis.
 *
 * <p>No PII redaction: the bank's error fields are stable enums +
 * generic descriptions (verified PayBox/Pepper/OneZero); they do
 * NOT echo back customer credentials. Length caps keep the surface
 * bounded.
 *
 * @param doc - The response envelope (already parsed JSON).
 * @returns A `bank-error: ...` suffix string (empty when the doc
 *   does not look like an error envelope).
 */
/** String-field caps: lookup keyed by hint field name. */
const STRING_HINT_CAPS: Readonly<Record<'name' | 'message' | 'explanation', number>> = {
  name: HINT_NAME_MAX_LEN,
  message: HINT_MESSAGE_MAX_LEN,
  explanation: HINT_MESSAGE_MAX_LEN,
};

/**
 * Detect whether the response envelope looks like a bank error
 * envelope (object with primitive `code` and/or short `name` /
 * `message` / `explanation` strings) and produce a
 * `[bank-error: ...]` suffix surfacing the bank's reported error.
 *
 * <p>Reasoning: when the bank returns an error response, the
 * configured success-envelope JSON pointer (e.g.
 * `/content/access_token`) will not resolve. Without this sniff
 * the only signal is "selector miss", which forces the operator to
 * re-run with PII_REDACTION=off to see what the bank actually said.
 *
 * <p>No PII redaction: bank error envelopes (verified PayBox /
 * Pepper / OneZero) carry only stable error enums + generic
 * descriptions; they do NOT echo back customer credentials. Length
 * caps keep the surface bounded.
 *
 * @param doc - The response envelope (already parsed JSON).
 * @returns A ` [bank-error: ...]` suffix string (empty when the doc
 *   does not look like an error envelope).
 */
function bankErrorHints(doc: JsonValue): string {
  if (!doc || typeof doc !== 'object' || Array.isArray(doc)) return '';
  const obj = doc as Record<string, unknown>;
  const parts: string[] = [];
  appendCodeHint(parts, obj.code);
  appendStringHint(parts, ['name', obj.name]);
  appendStringHint(parts, ['message', obj.message]);
  appendStringHint(parts, ['explanation', obj.explanation]);
  if (parts.length === 0) return '';
  return ` [bank-error: ${parts.join(' ')}]`;
}

/**
 * Push a `code=<value>` hint when the envelope's code field is a
 * number or short string.
 *
 * @param acc - Accumulated hint parts.
 * @param code - Raw envelope `code` field.
 * @returns True when a hint was appended.
 */
function appendCodeHint(acc: string[], code: unknown): boolean {
  if (typeof code !== 'string' && typeof code !== 'number') return false;
  acc.push(`code=${String(code).slice(0, HINT_CODE_MAX_LEN)}`);
  return true;
}

/**
 * Push a `<field>=<value>` hint when the envelope's `field` is a
 * non-empty string, capped at the per-field max length from
 * {@link STRING_HINT_CAPS}.
 *
 * @param acc - Accumulated hint parts.
 * @param entry - Tuple of [hint field name, raw envelope value].
 * @returns True when a hint was appended.
 */
function appendStringHint(
  acc: string[],
  entry: readonly [keyof typeof STRING_HINT_CAPS, unknown],
): boolean {
  const [field, value] = entry;
  if (typeof value !== 'string' || value.length === 0) return false;
  acc.push(`${field}=${value.slice(0, STRING_HINT_CAPS[field])}`);
  return true;
}

/**
 * Absorb one selector into the accumulator. Extracted to satisfy
 * max-depth 1; propagates the first miss as the final failure. On
 * miss, sniffs the response envelope for a {@link bankErrorHints}
 * suffix so the operator sees the bank's actual error code without
 * needing to re-run with PII_REDACTION=off.
 *
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
    const hints = bankErrorHints(doc);
    return fail(ScraperErrorTypes.Generic, `envelope selector miss: ${name} at ${pointer}${hints}`);
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
