/**
 * `accept` redirect policy: send without following, file the Set-Cookie
 * lines, and surface a 3xx as a 200 so a WAF handshake can be a step.
 */

import type { Procedure } from '../../Types/Procedure.js';
import { isOk, succeed } from '../../Types/Procedure.js';
import type { IRedirectRun, IRunEnd } from './RedirectFollow.js';
import { answeredUrl, emitSetCookies, isRedirectStatus } from './RedirectShared.js';

/**
 * Read a response body, treating an already-aborted stream as empty.
 * @param response - The response.
 * @returns Its text, or '' when the stream is aborted.
 */
async function bodyOrEmpty(response: Response): Promise<string> {
  try {
    return await response.text();
  } catch {
    return '';
  }
}

/**
 * Send the request without following and return a 3xx as the answer, filing
 * its Set-Cookie lines so the next step carries them (a WAF handshake).
 * @param run - The run.
 * @returns The response or the transport failure.
 */
async function sendAccept(run: IRedirectRun): Promise<Procedure<IRunEnd>> {
  const sent = await run.invoke(run.url, { ...run.init, redirect: 'manual' }, run);
  if (!isOk(sent)) return sent;
  const { value } = sent;
  const responseUrl = answeredUrl(value, run.url);
  emitSetCookies(value, responseUrl, run.onSetCookie);
  const status = isRedirectStatus(value.status) ? 200 : value.status;
  const body = await bodyOrEmpty(value);
  return succeed({ response: new Response(body, { status, headers: value.headers }), responseUrl });
}

export default sendAccept;
export { sendAccept };
