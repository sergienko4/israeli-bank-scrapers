/**
 * Keep persisted durable-auth values out of a renewal failure.
 *
 * <p>Renewal passes the flow's own failure through, so the caller sees which
 * step failed. That text can quote the bank's response body, and a bank may
 * echo request values back — the device id it was sent, the account it was
 * sent as `uid`, or the token it rejected. Those values are the stored device
 * state, which must never reach `errorMessage`. Transports already strip the
 * query string; this scrub covers whatever else the failure text quotes.
 */

import { none } from '../../../Types/Option.js';
import { REDACTED_HINT } from '../../../Types/PiiRedactor.js';
import type { IProcedureFailure } from '../../../Types/Procedure.js';
import type { IPersistentAuthStateV1 } from '../PersistentAuthStateCodec.js';

/** Persisted fields a failure must never quote. The decoder guarantees each is non-empty. */
const PERSISTED_SECRET_FIELDS = [
  'accessToken',
  'account',
  'clientInstanceId',
  'deviceId',
  'ecPrivateKeyPkcs8Base64',
] as const;

/**
 * Replace every persisted secret value the failure text quotes.
 * @param failure - Failed renewal flow.
 * @param state - Persisted state the renewal ran on.
 * @returns The same failure with each persisted value redacted.
 */
function scrubPersistedValues(
  failure: IProcedureFailure,
  state: IPersistentAuthStateV1,
): IProcedureFailure {
  const errorMessage = PERSISTED_SECRET_FIELDS.reduce(
    (text: string, field): string => text.replaceAll(state[field], REDACTED_HINT),
    failure.errorMessage,
  );
  return { ...failure, errorMessage };
}

/**
 * Omit a failed device-memory flow's text: the bank may echo only a truncated
 * prefix of a stored id or account, which replacing whole values cannot scrub.
 * @param failure - Flow failure, whose type remains unchanged.
 * @returns A category-only failure without bank-controlled text or details.
 */
function omitFlowFailureText(failure: IProcedureFailure): IProcedureFailure {
  return { ...failure, errorMessage: 'persistent auth failed: flow', errorDetails: none() };
}

export default scrubPersistedValues;
export { omitFlowFailureText, scrubPersistedValues };
