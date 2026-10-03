/**
 * Describe a failed `JSON.parse` without echoing its input.
 *
 * V8's SyntaxError quotes the text it rejected (`"ACCT4580…" is not valid
 * JSON`), and that text is a bank response or a captured request body. Only
 * the error name and the engine's decimal position survive; every other
 * error keeps its own message.
 */

import ScraperError from '../../Base/ScraperError.js';
import type { Brand } from './Brand.js';
import { toError } from './ErrorUtils.js';
import type { JsonUnknown } from './JsonValue.js';

/** Failure text that carries no part of the rejected JSON input. */
type JsonParseFailureText = Brand<string, 'JsonParseFailureText'>;

/**
 * V8's positional suffix, anchored to the end of the message so digits
 * inside a quoted excerpt (`"x JSON at position 4580" is not valid JSON`)
 * can never be taken for the position.
 */
const POSITION_SUFFIX_RE = / JSON at position (\d+)(?: \(line \d+ column \d+\))?$/;

/**
 * Read the engine's decimal position from a parse-error message.
 * @param message - The SyntaxError message.
 * @returns ` at position N`, or empty when the engine quoted the input instead.
 */
function positionSuffix(message: string): string {
  const digits = POSITION_SUFFIX_RE.exec(message)?.[1];
  if (digits === undefined) return '';
  return ` at position ${digits}`;
}

/**
 * Describe a caught parse failure without any of the rejected input.
 * Matched by name, not `instanceof`: a SyntaxError from another realm
 * (Node internals under Jest's ESM VM) is not the local class.
 * @param caught - The value a `JSON.parse` call site caught.
 * @returns `invalid JSON (SyntaxError[ at position N])` for a parse error,
 *          otherwise the error's own message.
 */
function describeJsonParseFailure(caught: unknown): JsonParseFailureText {
  const error = toError(caught);
  if (error.name !== 'SyntaxError') return error.message as JsonParseFailureText;
  const position = positionSuffix(error.message);
  return `invalid JSON (SyntaxError${position})` as JsonParseFailureText;
}

/**
 * Parse JSON, throwing a failure that names the context but not the input.
 * The engine error is deliberately not chained as `cause`: it would carry
 * the quoted input into any logger that serialises the cause chain.
 * @param text - Text to parse.
 * @param context - Caller label prefixed to the failure, e.g. `fetchGet parse error`.
 * @returns The parsed value; callers narrow it to their own shape.
 */
function parseJsonOrThrow(text: string, context: string): JsonUnknown {
  try {
    return JSON.parse(text) as JsonUnknown;
  } catch (error) {
    const reason = describeJsonParseFailure(error);
    throw new ScraperError(`${context}: ${reason}`);
  }
}

export type { JsonParseFailureText };
export { describeJsonParseFailure, parseJsonOrThrow };
