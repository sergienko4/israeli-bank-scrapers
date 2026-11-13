/**
 * Redirect follow — sends one request under its redirect policy.
 * `follow` hands the request to fetch untouched; `reject` asks fetch not to
 * follow and refuses any 3xx; a manual policy follows only the hops its
 * status rules allow (see RedirectHopRules: a POST only under `postAsGet`)
 * whose Location resolves to an allowed URL, at most `maxHops` times.
 * Every hop is a body-less GET through the same transport seam, so each hop
 * keeps the per-request cap. A hop's Set-Cookie lines are filed under the hop
 * URL before the next hop is built. Each hop starts from the previous hop's
 * headers and replaces every header the session owns with the session's
 * headers for the hop URL — a value computed for another URL is never reused.
 * Once any hop changes origin the credentials headers are dropped for the
 * rest of the run, whether the caller or the session set them. Location
 * values are never logged and never put in a failure message.
 */

import { ScraperErrorTypes } from '../../../Base/ErrorTypes.js';
import type { IManualRedirect, IUrlRule } from '../../Types/Domain/FetchPolicy.js';
import { REDIRECT_REFUSED_REASON } from '../../Types/Domain/FetchPolicy.js';
import type { Option } from '../../Types/Option.js';
import { none, some } from '../../Types/Option.js';
import type { Procedure } from '../../Types/Procedure.js';
import { fail, isOk, succeed } from '../../Types/Procedure.js';
import type { HttpVerb, IFetchInvokePolicy, ISessionHeaders } from './FetchStrategy.js';
import { sendAccept } from './RedirectAccept.js';
import { droppedOnHop, followedAfter, hopHeaders, postStatusesOf } from './RedirectHopRules.js';
import type { IRedirectRun, IRunEnd } from './RedirectShared.js';
import { answeredUrl, emitSetCookies, isRedirectStatus } from './RedirectShared.js';
import { cancelResponseBody } from './ResponseBody.js';
import { safeUrlForLog } from './SafeUrlForLog.js';
import { matchesAnyUrlRule } from './UrlRule.js';

/** One request of a manual run and the hops still allowed after it. */
interface IHop {
  readonly url: string;
  readonly init: RequestInit;
  readonly verb: HttpVerb;
  readonly hopsLeft: number;
  /** Set once any hop changed origin; credentials are never sent again. */
  readonly hasCrossedOrigin: boolean;
}

/** A manual run and the rules its hops must match. */
interface IManualRun {
  readonly run: IRedirectRun;
  readonly rules: readonly IUrlRule[];
  /** Statuses an answer to a POST is followed on. */
  readonly postStatuses: ReadonlySet<number>;
}

/** Sends one run under a fixed (string) policy. */
type Sender = (run: IRedirectRun) => Promise<Procedure<IRunEnd>>;

/** Session headers of a run without a session: no Cookie header on any hop. */
const NO_SESSION: ISessionHeaders = { owned: ['cookie'], values: {} };

/**
 * Refuse a redirect without naming the refused target.
 * @param run - The run.
 * @param status - Fixed-policy refusal status; manual refusals omit it.
 * @returns Generic failure naming only the request URL.
 */
function refused(run: IRedirectRun, status?: number): Procedure<IRunEnd> {
  const safeUrl = safeUrlForLog(run.url, run.redactUrlValues);
  const statusText = status === undefined ? '' : `HTTP ${String(status)} `;
  const message = `${run.verb} ${safeUrl} ${statusText}${REDIRECT_REFUSED_REASON}`;
  return fail(ScraperErrorTypes.Generic, message);
}

/**
 * Send the request as-is; fetch follows any redirect itself.
 * @param run - The run.
 * @returns The response, or the transport failure.
 */
async function sendFollow(run: IRedirectRun): Promise<Procedure<IRunEnd>> {
  const sent = await run.invoke(run.url, run.init, run);
  if (!isOk(sent)) return sent;
  return succeed({ response: sent.value, responseUrl: answeredUrl(sent.value, run.url) });
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
  emitSetCookies(sent.value, responseUrl, run.onSetCookie);
  await cancelResponseBody(sent.value, run);
  return refused(run, status);
}

/** Sender per fixed policy. */
const FIXED_SENDERS: Readonly<Record<'follow' | 'reject' | 'accept', Sender>> = {
  follow: sendFollow,
  reject: sendReject,
  accept: sendAccept,
};

/**
 * The allowed target a redirect points at.
 * @param response - The redirect response.
 * @param hop - The request that drew it.
 * @param ctx - The run, its rules and its POST statuses.
 * @returns The target, or none when the redirect may not be followed.
 */
function hopTarget(response: Response, hop: IHop, ctx: IManualRun): Option<URL> {
  const statuses = followedAfter(hop.verb, ctx.postStatuses);
  if (hop.hopsLeft < 1 || !statuses.has(response.status)) return none();
  const location = response.headers.get('location');
  if (location === null || !URL.canParse(location, hop.url)) return none();
  const target = new URL(location, hop.url);
  if (!matchesAnyUrlRule(target, ctx.rules)) return none();
  return some(target);
}

/**
 * The session's headers for a hop URL.
 * @param run - The run.
 * @param url - Hop URL.
 * @returns The session's headers, none for a run without a session, or the
 *   failure that stops the hop.
 */
function sessionFor(run: IRedirectRun, url: string): Procedure<ISessionHeaders> {
  if (!run.sessionHeadersFor) return succeed(NO_SESSION);
  return run.sessionHeadersFor(url);
}

/**
 * Build the body-less GET for an allowed target.
 * @param run - The run.
 * @param hop - The request that redirected.
 * @param target - Allowed target.
 * @returns The next hop, or the failure of the session's headers for it.
 */
function nextHop(run: IRedirectRun, hop: IHop, target: URL): Procedure<IHop> {
  const url = target.href;
  const session = sessionFor(run, url);
  if (!isOk(session)) return session;
  const hasCrossedOrigin = hop.hasCrossedOrigin || new URL(hop.url).origin !== target.origin;
  const dropped = droppedOnHop(run.verb === 'POST', hasCrossedOrigin);
  const headers = hopHeaders(hop.init.headers, session.value, dropped);
  const init: RequestInit = { method: 'GET', headers, redirect: 'manual' };
  return succeed({ url, init, verb: 'GET', hopsLeft: hop.hopsLeft - 1, hasCrossedOrigin });
}

/**
 * Send one request of a manual run and follow it while it redirects.
 * @param ctx - The run and its rules.
 * @param hop - The request to send.
 * @returns The final response, a refusal, or the transport failure.
 */
async function sendHop(ctx: IManualRun, hop: IHop): Promise<Procedure<IRunEnd>> {
  const redaction = { redactUrlValues: ctx.run.redactUrlValues };
  const policy: IFetchInvokePolicy = { verb: hop.verb, mediaType: ctx.run.mediaType, ...redaction };
  const sent = await ctx.run.invoke(hop.url, hop.init, policy);
  if (!isOk(sent)) return sent;
  const response = sent.value;
  const responseUrl = answeredUrl(response, hop.url);
  if (!isRedirectStatus(response.status)) return succeed({ response, responseUrl });
  return continueHop(ctx, hop, { response, responseUrl });
}

/**
 * File a redirect's cookies, then send the next hop or refuse the run. A
 * failure of the hop's session headers stops the run before the hop is sent,
 * after the redirect's own cookies are filed.
 * @param ctx - The run and its rules.
 * @param hop - The request that redirected.
 * @param end - The redirect and the URL it answered.
 * @returns The final response, a refusal, or the transport or header failure.
 */
async function continueHop(ctx: IManualRun, hop: IHop, end: IRunEnd): Promise<Procedure<IRunEnd>> {
  emitSetCookies(end.response, end.responseUrl, ctx.run.onSetCookie);
  const hopContext = { verb: hop.verb, url: hop.url, redactUrlValues: ctx.run.redactUrlValues };
  await cancelResponseBody(end.response, hopContext);
  const target = hopTarget(end.response, hop, ctx);
  if (!target.has) return refused(ctx.run);
  const next = nextHop(ctx.run, hop, target.value);
  if (!isOk(next)) return next;
  return sendHop(ctx, next.value);
}

/**
 * Run a request under a manual policy.
 * @param run - The run.
 * @param policy - Hop budget, allowed targets and whether a POST turns GET.
 * @returns The final response, a refusal, or the transport failure.
 */
function sendManual(run: IRedirectRun, policy: IManualRedirect): Promise<Procedure<IRunEnd>> {
  const init: RequestInit = { ...run.init, redirect: 'manual' };
  const hopsLeft = policy.maxHops;
  const first: IHop = { url: run.url, init, verb: run.verb, hopsLeft, hasCrossedOrigin: false };
  const postStatuses = postStatusesOf(policy);
  return sendHop({ run, rules: policy.allow, postStatuses }, first);
}

/**
 * Send one request under its redirect policy.
 * @param run - The request, its transport seam and its policy.
 * @returns The response that ended the run and its URL, or a failure.
 */
function sendUnderPolicy(run: IRedirectRun): Promise<Procedure<IRunEnd>> {
  const policy = run.policy;
  if (typeof policy === 'string') return FIXED_SENDERS[policy](run);
  return sendManual(run, policy);
}

export default sendUnderPolicy;
export type { IRedirectRun, IRunEnd } from './RedirectShared.js';
export { sendUnderPolicy };
export { answeredUrl } from './RedirectShared.js';
