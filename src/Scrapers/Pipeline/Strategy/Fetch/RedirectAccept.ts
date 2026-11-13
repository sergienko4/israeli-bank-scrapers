/**
 * `accept` redirect policy: send without following and surface a 3xx as a 200
 * so a WAF handshake can be a step. The dispatcher files the final answer's
 * cookies, so this policy never emits them itself.
 */

import type { Procedure } from '../../Types/Procedure.js';
import { isOk, succeed } from '../../Types/Procedure.js';
import { readBodyText } from './BodyText.js';
import { hasCloudflareChallengeHeader } from './HttpFailureClassifier.js';
import type { IRedirectRun, IRunEnd } from './RedirectShared.js';
import { answeredUrl, isRedirectStatus } from './RedirectShared.js';
import type { IAnswer } from './StatusPolicy.js';

/** Reading policy of a unit-test run that names none: plain text, not strict. */
const DEFAULT_READING: IAnswer['reading'] = { statusPolicy: {}, responseKind: 'text' };

/**
 * Read a redirect's body through the same reader every text answer uses, so
 * `strictUtf8` is honoured and a failed read is not replaced by empty text.
 * @param run - The run.
 * @param response - The redirect response.
 * @returns Its text, or a Generic failure naming the request URL only.
 */
async function redirectBody(run: IRedirectRun, response: Response): Promise<Procedure<string>> {
  const reading = run.reading ?? DEFAULT_READING;
  const answer: IAnswer = { response, verb: run.verb, url: run.url, reading };
  return readBodyText(answer);
}

/**
 * Read a redirect's body and rebuild it as the accepted answer.
 * @param run - The run.
 * @param value - The redirect response.
 * @param responseUrl - The URL that answered it.
 * @returns The 200 answer or the body-read failure.
 */
async function acceptedRedirect(
  run: IRedirectRun,
  value: Response,
  responseUrl: string,
): Promise<Procedure<IRunEnd>> {
  const body = await redirectBody(run, value);
  if (!isOk(body)) return body;
  const response = new Response(body.value, { status: 200, headers: value.headers });
  return succeed({ response, responseUrl });
}

/**
 * Whether a response is a Cloudflare challenge, which must reach the WAF
 * classifier untouched instead of being rebuilt as a 200.
 * @param response - The redirect response.
 * @returns True when the edge marked it as a challenge.
 */
function isChallenge(response: Response): boolean {
  const headers = Object.fromEntries(response.headers);
  return hasCloudflareChallengeHeader(headers);
}

/**
 * Send the request without following and return a 3xx as the answer. A
 * non-redirect response is returned untouched: rebuilding a 204 or 205 with a
 * body throws, which would bypass the status policy that owns them.
 *
 * <p>The accepted response is the run's final answer, so the dispatcher files
 * its Set-Cookie lines once; emitting them here too would double the call.</p>
 * @param run - The run.
 * @returns The response, the body-read failure or the transport failure.
 */
async function sendAccept(run: IRedirectRun): Promise<Procedure<IRunEnd>> {
  const sent = await run.invoke(run.url, { ...run.init, redirect: 'manual' }, run);
  if (!isOk(sent)) return sent;
  const { value } = sent;
  const responseUrl = answeredUrl(value, run.url);
  if (!isRedirectStatus(value.status)) return succeed({ response: value, responseUrl });
  if (isChallenge(value)) return succeed({ response: value, responseUrl });
  return acceptedRedirect(run, value, responseUrl);
}

export default sendAccept;
export { sendAccept };
