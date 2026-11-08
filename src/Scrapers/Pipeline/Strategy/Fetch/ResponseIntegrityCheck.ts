/**
 * Refuses malformed or unsupported response-integrity policies before I/O.
 */

import { ScraperErrorTypes } from '../../../Base/ErrorTypes.js';
import {
  RESPONSE_INTEGRITY_INVALID_REASON,
  RESPONSE_INTEGRITY_UNSUPPORTED_REASON,
} from '../../Types/Domain/FetchPolicy.js';
import { isResponseIntegrity } from '../../Types/Domain/ResponseIntegrityPolicy.js';
import type { IProcedureFailure, Procedure } from '../../Types/Procedure.js';
import { fail, succeed } from '../../Types/Procedure.js';

/**
 * Marks a fixed integrity refusal as terminal without exposing response content.
 * @param reason - Fixed integrity failure reason.
 * @returns Tagged integrity failure.
 */
function failResponseIntegrity(reason: string): IProcedureFailure {
  const refusal = fail(ScraperErrorTypes.Generic, reason);
  return { ...refusal, responseIntegrityRefusal: true };
}

/**
 * Checks one policy against a transport's supported capabilities.
 * @param policy - Untrusted optional policy.
 * @param supported - Whether this transport enforces it.
 * @returns Success when absent or supported and valid; otherwise a fixed refusal.
 */
function checkResponseIntegrity(policy: unknown, supported: boolean): Procedure<void> {
  if (policy === undefined) return succeed(undefined);
  if (!isResponseIntegrity(policy)) return failResponseIntegrity(RESPONSE_INTEGRITY_INVALID_REASON);
  if (!supported) return failResponseIntegrity(RESPONSE_INTEGRITY_UNSUPPORTED_REASON);
  return succeed(undefined);
}

export default checkResponseIntegrity;
export { checkResponseIntegrity, failResponseIntegrity };
