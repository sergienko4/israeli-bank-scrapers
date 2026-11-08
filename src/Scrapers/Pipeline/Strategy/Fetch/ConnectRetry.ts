/**
 * Connect-phase retry for the native transport.
 *
 * Some bank edges silently drop a share of new TCP/TLS handshakes. Node's
 * fetch gives up on such a connection after its own connect budget, with a
 * bare `fetch failed` whose real reason is `error.cause.code`. A connect
 * timeout means the request never left the client, so replaying it on a fresh
 * connection cannot double-submit a one-time code or a payment.
 */

import { getDebug } from '../../Logging/Debug.js';
import { errorCauseCodeOf } from '../../Types/ErrorUtils.js';

/** Module logger — name derived from source filename per project convention. */
const LOG = getDebug(import.meta.url);

/** `error.cause.code` undici reports when no handshake completed in its connect budget. */
const CONNECT_TIMEOUT_CODE = 'UND_ERR_CONNECT_TIMEOUT';

/** One failed attempt and what is needed to decide whether to repeat it. */
interface IConnectFailure<T> {
  readonly error: unknown;
  readonly retries: number;
  readonly again: () => Promise<T>;
}

/**
 * Whether a rejection means no connection was ever established.
 * @param error - The caught value, from any realm.
 * @returns True only for a connect timeout, when nothing reached the server.
 */
function isConnectTimeout(error: unknown): boolean {
  return errorCauseCodeOf(error) === CONNECT_TIMEOUT_CODE;
}

/**
 * Repeat a failed attempt when it never connected, otherwise surface the error.
 * @param failure - The rejection, repeats still allowed and how to repeat.
 * @returns The repeated attempt's result.
 * @throws The original rejection when it is not a connect timeout or no repeats remain.
 */
async function retryOrThrow<T>(failure: IConnectFailure<T>): Promise<T> {
  if (failure.retries < 1 || !isConnectTimeout(failure.error)) throw failure.error;
  LOG.debug({ retriesLeft: failure.retries, message: '[fetch] CONNECT TIMEOUT retry' });
  return failure.again();
}

/**
 * Run an attempt, starting it again on a fresh connection while it times out connecting.
 * @param attempt - Starts one request; invoked again after a connect timeout.
 * @param retries - Repeats still allowed once this attempt fails to connect.
 * @returns The first attempt's result that is not a connect timeout.
 */
async function retryOnConnectTimeout<T>(attempt: () => Promise<T>, retries: number): Promise<T> {
  try {
    return await attempt();
  } catch (error) {
    /**
     * Start the next attempt with one fewer repeat left.
     * @returns The next attempt's result.
     */
    const again = async (): Promise<T> => retryOnConnectTimeout(attempt, retries - 1);
    return retryOrThrow({ error, retries, again });
  }
}

export { isConnectTimeout, retryOnConnectTimeout };
