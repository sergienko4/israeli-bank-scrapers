/**
 * `reject` redirect policy: send without following and refuse any 3xx.
 *
 * <p>A redirect a step marks as its auth portal is still a body-free refusal;
 * a header-marked Cloudflare challenge must reach the shared WAF classifier
 * instead, because a challenge is terminal and must never buy a cold login.</p>
 */

import type { Procedure } from '../../Types/Procedure.js';
import { isOk, succeed } from '../../Types/Procedure.js';
import { classifyHttpFailure, hasCloudflareChallengeHeader } from './HttpFailureClassifier.js';
import refused from './RedirectRefusal.js';
import type { IRedirectRun, IRunEnd } from './RedirectShared.js';
import { answeredUrl, emitSetCookies, isRedirectStatus } from './RedirectShared.js';
import cancelResponseBody from './ResponseBody.js';

/**
 * Whether a redirect response is a Cloudflare challenge. Such an answer must
 * reach the shared WAF classifier, not become a cold-login trigger.
 * @param response - The redirect response.
 * @returns True when the edge marked it as a challenge.
 */
function isChallenge(response: Response): boolean {
  const headers = Object.fromEntries(response.headers);
  return hasCloudflareChallengeHeader(headers);
}

/**
 * Classify a header-marked challenge with the shared WAF rules.
 * @param run - The run.
 * @param response - The challenge response.
 * @param status - The 3xx status.
 * @returns The WafBlocked failure.
 */
function challengeFailure(
  run: IRedirectRun,
  response: Response,
  status: number,
): Procedure<IRunEnd> {
  const headers = Object.fromEntries(response.headers);
  const failure = { verb: run.verb, url: run.url, status, body: '', headers };
  return classifyHttpFailure<IRunEnd>(failure);
}

/** The inputs one rejected-response refusal needs. */
interface IRejectRefusal {
  readonly run: IRedirectRun;
  readonly end: IRunEnd;
  readonly status: number;
}

/**
 * File a refused redirect's cookies, then refuse it with its typed target.
 * @param args - Run, redirect answer and status.
 * @returns The refusal.
 */
async function refuseRejected(args: IRejectRefusal): Promise<Procedure<IRunEnd>> {
  const { run, end, status } = args;
  await cancelResponseBody(end.response, run);
  if (isChallenge(end.response)) return challengeFailure(run, end.response, status);
  emitSetCookies(end.response, end.responseUrl, run.onSetCookie);
  const options = { status, response: end.response, responseUrl: end.responseUrl };
  return refused(run, options);
}

/**
 * Send the request without following, and refuse any 3xx.
 * @param run - The run.
 * @returns The response, a refusal, or the transport failure.
 */
async function sendReject(run: IRedirectRun): Promise<Procedure<IRunEnd>> {
  const sent = await run.invoke(run.url, { ...run.init, redirect: 'manual' }, run);
  if (!isOk(sent)) return sent;
  const { status } = sent.value;
  const responseUrl = answeredUrl(sent.value, run.url);
  if (!isRedirectStatus(status)) return succeed({ response: sent.value, responseUrl });
  return refuseRejected({ run, end: { response: sent.value, responseUrl }, status });
}

export default sendReject;
