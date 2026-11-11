/**
 * Login-step failure sanitiser.
 *
 * <p>The transport quotes up to 120 characters of the response body in a
 * Generic failure, and a bank may echo request secrets (credentials, OTP,
 * device ids) back in that body. A failed login step is therefore reported by
 * its name plus the HTTP status — or plus the error type when no response
 * arrived — so no response text leaves the login flow. The retry layer sits
 * below this point and still reads the original message.
 *
 * <p>A policy refusal raised by the transport itself (`HTTP <status>`, a
 * refused redirect, an unverified document, an over-long text answer, or a
 * body its writer refused) quotes no response text, so the
 * step keeps that fixed tail; the whole message must have the refusal's
 * shape, so no body text can pass for one.
 *
 * <p>A step's `httpFailureMap` types a reply by its status, for a bank whose
 * 4xx on that step can only mean one thing; the message stays the same. Only
 * the transport's `<VERB> <url> <status>: ` reply prefix counts, so a request
 * that got no reply and a policy refusal keep their type.
 *
 * <p>A WAF block passes through unchanged: the transport already swapped the
 * edge page for a fixed reason, and that reason is a documented contract.
 */

import type { ScraperErrorTypes } from '../../../../../Base/ErrorTypes.js';
import {
  BODY_NOT_UTF8_REASON,
  DOCUMENT_UNVERIFIED_REASON,
  LATIN1_UNENCODABLE_REASON,
  MEDIA_TYPE_REFUSED_REASON,
  REDIRECT_REFUSED_REASON,
  RESPONSE_BYTE_LIMIT_REASON,
  RESPONSE_DIGEST_MISMATCH_REASON,
  RESPONSE_INTEGRITY_INVALID_REASON,
  RESPONSE_INTEGRITY_UNSUPPORTED_REASON,
  TEXT_BODY_REFUSED_REASON,
  TEXT_TOO_LONG_REASON,
} from '../../../../Types/Domain/FetchPolicy.js';
import type { IProcedureFailure } from '../../../../Types/Procedure.js';
import { isWafBlocked } from '../../../../Types/Procedure.js';
import type { IStepConfig } from '../../ConfigContracts/index.js';

/** What a failure is rebuilt from: a login step, or a scrape call by its name. */
type FailedStep = Pick<IStepConfig, 'httpFailureMap'> & { readonly name: string };

/**
 * The transport's reply prefix `<VERB> <safeUrl> NNN: ` (`HttpFailureClassifier`),
 * anchored so a no-reply reason quoting a status cannot pass for one.
 */
const STATUS_MARKER = /^\S+ \S+ (\d{3}):\s/;

/** Fixed reasons a transport policy refusal ends with. */
const REFUSAL_REASONS = [
  REDIRECT_REFUSED_REASON,
  DOCUMENT_UNVERIFIED_REASON,
  TEXT_TOO_LONG_REASON,
  LATIN1_UNENCODABLE_REASON,
  TEXT_BODY_REFUSED_REASON,
  MEDIA_TYPE_REFUSED_REASON,
  BODY_NOT_UTF8_REASON,
].join('|');

/** `<VERB> <safeUrl> ` then `HTTP NNN`, a fixed reason, or both — and nothing else. */
const POLICY_REFUSAL = new RegExp(
  String.raw`^\S+ \S+ (HTTP \d{3}(?: (?:${REFUSAL_REASONS}))?|${REFUSAL_REASONS})$`,
);

/** Fixed, body-free integrity reasons emitted by the native transport. */
const INTEGRITY_REFUSAL_REASONS: ReadonlySet<string> = new Set([
  RESPONSE_BYTE_LIMIT_REASON,
  RESPONSE_DIGEST_MISMATCH_REASON,
  RESPONSE_INTEGRITY_INVALID_REASON,
  RESPONSE_INTEGRITY_UNSUPPORTED_REASON,
]);

/**
 * Read the HTTP status the transport embedded in a failure message.
 * @param message - Original failure message.
 * @returns The 3-digit status, or '' when the request got no response.
 */
function readStatus(message: string): string {
  return STATUS_MARKER.exec(message)?.[1] ?? '';
}

/**
 * Read the fixed tail of a transport policy refusal.
 * @param message - Original failure message.
 * @returns The tail (`HTTP 207`, `document unverified`, …), or ''.
 */
function readRefusal(message: string): string {
  return POLICY_REFUSAL.exec(message)?.[1] ?? '';
}

/**
 * Describe a failure without quoting any of its text.
 * @param failure - Failure returned by the transport.
 * @returns `HTTP <status>` when a status is known, a policy refusal's fixed
 *   tail, else the error type.
 */
function describeFailure(failure: IProcedureFailure): string {
  const status = readStatus(failure.errorMessage);
  if (status.length > 0) return `HTTP ${status}`;
  const refusal = readRefusal(failure.errorMessage);
  if (refusal.length > 0) return refusal;
  return failure.errorType;
}

/**
 * Whether a failure carries a fixed reason, not text the bank sent.
 * @param failure - Failure returned by the transport.
 * @returns True for a WAF block or a native-transport integrity refusal.
 */
function isFixedReason(failure: IProcedureFailure): boolean {
  if (isWafBlocked(failure)) return true;
  if (failure.responseIntegrityRefusal !== true) return false;
  return INTEGRITY_REFUSAL_REASONS.has(failure.errorMessage);
}

/**
 * The failure type the step names for the reply's status.
 * @param step - The failed step.
 * @param failure - Failure returned by the transport.
 * @returns The mapped type, else the transport's.
 */
function typeByStatus(step: FailedStep, failure: IProcedureFailure): ScraperErrorTypes {
  const status = readStatus(failure.errorMessage);
  const mapped = step.httpFailureMap?.[status];
  return mapped ?? failure.errorType;
}

/**
 * Rebuild a failed step's message from its name and status only.
 * @param step - The failed step.
 * @param failure - Failure returned by the transport.
 * @returns The same failure, typed by the step's status map, with a safe
 *   message; a fixed reason as is.
 */
function sanitiseStepFailure(step: FailedStep, failure: IProcedureFailure): IProcedureFailure {
  if (isFixedReason(failure)) return failure;
  const detail = describeFailure(failure);
  const errorType = typeByStatus(step, failure);
  return { ...failure, errorType, errorMessage: `${step.name} ${detail}` };
}

export default sanitiseStepFailure;
export { sanitiseStepFailure };
