/**
 * Describe a failed `JSON.parse` without echoing its input.
 *
 * V8's SyntaxError quotes the text it rejected (`"ACCT4580…" is not valid
 * JSON`), and that text is a bank response or a captured request body. Only
 * the error name and the engine's decimal position survive; every other
 * error keeps its own message.
 */

import type { Brand } from './Brand.js';
import { toError } from './ErrorUtils.js';

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

export default describeJsonParseFailure;
