/**
 * Releases bodies discarded by transport policies without changing their verdict.
 */

import { getDebug } from '../../Logging/Debug.js';
import type { HttpVerb } from './FetchStrategy.js';
import { safeUrlForLog } from './SafeUrlForLog.js';

interface IRequestContext {
  readonly verb: HttpVerb;
  readonly url: string;
}

const LOG = getDebug(import.meta.url);

/**
 * Cancels an unused body, retaining the policy verdict if cleanup rejects.
 * Already-aborted transports can reject cancellation; diagnostics never include
 * the rejection text, which may contain response data.
 * https://developer.mozilla.org/en-US/docs/Web/API/ReadableStream/cancel
 * @param response - Response whose body the transport will not read.
 * @param request - Request identity for a log-safe cleanup diagnostic.
 * @returns True when cancellation succeeds or no body exists; false after a logged failure.
 */
async function cancelResponseBody(response: Response, request: IRequestContext): Promise<boolean> {
  try {
    await response.body?.cancel();
    return true;
  } catch {
    const url = safeUrlForLog(request.url);
    LOG.warn({ verb: request.verb, url, message: 'Response body cancellation failed' });
    return false;
  }
}

export default cancelResponseBody;
export { cancelResponseBody };
