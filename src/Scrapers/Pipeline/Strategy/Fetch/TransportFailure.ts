/**
 * Shared transport-failure classification: native fetch and node:https mTLS
 * map aborted signals to `TIMEOUT` and socket failures to `NETWORK_ERROR` the
 * same way, so callers see one classification whichever transport ran.
 */

import { ScraperErrorTypes } from '../../../Base/ErrorTypes.js';

/** Error names a transport rejects with once its abort signal fires. */
const ABORT_ERROR_NAMES: ReadonlySet<unknown> = new Set(['AbortError', 'TimeoutError']);

/** Node and undici codes that mean the connection or its socket failed. */
const SOCKET_ERROR_CODES: ReadonlySet<string> = new Set([
  'EAI_AGAIN',
  'ECONNABORTED',
  'ECONNREFUSED',
  'ECONNRESET',
  'EHOSTUNREACH',
  'ENETUNREACH',
  'ENOTFOUND',
  'EPIPE',
  'ERR_SOCKET_CONNECTION_TIMEOUT',
  'ERR_STREAM_PREMATURE_CLOSE',
  'ETIMEDOUT',
  'UND_ERR_BODY_TIMEOUT',
  'UND_ERR_CONNECT_TIMEOUT',
  'UND_ERR_HEADERS_TIMEOUT',
  'UND_ERR_SOCKET',
]);

/** Shape of a system or undici error code. */
const CODE_PATTERN = /^[A-Z][A-Z0-9_]{2,40}$/;

/**
 * Whether a rejection came from an aborted signal. Reads `name` instead of
 * using `instanceof DOMException`, which fails across realms.
 * @param error - The caught value.
 * @returns True for a `TimeoutError` / `AbortError`.
 */
function isAbortRejection(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) return false;
  try {
    const name: unknown = Reflect.get(error, 'name');
    return ABORT_ERROR_NAMES.has(name);
  } catch {
    return false;
  }
}

/**
 * A well-formed code on one error-like value.
 * @param value - A caught error or its cause.
 * @returns The code, or '' when none is readable.
 */
function codeOf(value: unknown): string {
  if (typeof value !== 'object' || value === null) return '';
  try {
    const code: unknown = Reflect.get(value, 'code');
    return typeof code === 'string' && CODE_PATTERN.test(code) ? code : '';
  } catch {
    return '';
  }
}

/**
 * The first well-formed code on the error or its cause.
 * @param error - The caught value.
 * @returns The code, or '' when none is readable.
 */
function errorCodeOf(error: unknown): string {
  const own = codeOf(error);
  if (own !== '') return own;
  const cause = causeOf(error);
  return codeOf(cause);
}

/**
 * The cause of a caught value, when it is readable.
 * @param error - The caught value.
 * @returns The cause, or false when none is readable.
 */
function causeOf(error: unknown): unknown {
  if (typeof error !== 'object' || error === null) return false;
  try {
    const cause: unknown = Reflect.get(error, 'cause');
    return cause;
  } catch {
    return false;
  }
}

/**
 * Classify a transport rejection into the public error type callers see.
 * @param error - The caught value.
 * @returns TIMEOUT for an abort, NETWORK_ERROR for a socket failure, else GENERIC.
 */
function transportErrorType(error: unknown): ScraperErrorTypes {
  if (isAbortRejection(error)) return ScraperErrorTypes.Timeout;
  const code = errorCodeOf(error);
  return SOCKET_ERROR_CODES.has(code) ? ScraperErrorTypes.NetworkError : ScraperErrorTypes.Generic;
}

export default transportErrorType;
