/**
 * Login-step failure sanitiser (E15).
 *
 * <p>The transport quotes up to 120 characters of the response body in a
 * Generic failure, and a bank may echo request secrets (credentials, OTP,
 * device ids) back in that body. A failed login step is therefore reported by
 * its name plus the HTTP status — or plus the error type when no response
 * arrived — so no response text leaves the login flow. The retry layer sits
 * below this point and still reads the original message.
 *
 * <p>A WAF block passes through unchanged: the transport already swapped the
 * edge page for a fixed reason, and that reason is a documented contract.
 */

import type { IProcedureFailure } from '../../../Types/Procedure.js';
import { isWafBlocked } from '../../../Types/Procedure.js';

/** The transport's `<sp>NNN:<sp>` status marker (precedent: `ApiMediator.authReject`). */
const STATUS_MARKER = /\s(\d{3}):\s/;

/**
 * Read the HTTP status the transport embedded in a failure message.
 * @param message - Original failure message.
 * @returns The 3-digit status, or '' when the request got no response.
 */
function readStatus(message: string): string {
  return STATUS_MARKER.exec(message)?.[1] ?? '';
}

/**
 * Describe a failure without quoting any of its text.
 * @param failure - Failure returned by the transport.
 * @returns `HTTP <status>` when a status is known, the error type otherwise.
 */
function describeFailure(failure: IProcedureFailure): string {
  const status = readStatus(failure.errorMessage);
  if (status.length > 0) return `HTTP ${status}`;
  return failure.errorType;
}

/**
 * Rebuild a failed step's message from its name and status only.
 * @param stepName - Name of the failed step.
 * @param failure - Failure returned by the transport.
 * @returns The same failure, type kept, with a safe message; a WAF block as is.
 */
function sanitiseStepFailure(stepName: string, failure: IProcedureFailure): IProcedureFailure {
  if (isWafBlocked(failure)) return failure;
  const detail = describeFailure(failure);
  return { ...failure, errorMessage: `${stepName} ${detail}` };
}

export default sanitiseStepFailure;
export { sanitiseStepFailure };
