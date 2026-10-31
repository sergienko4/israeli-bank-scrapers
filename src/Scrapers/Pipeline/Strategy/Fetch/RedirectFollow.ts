/**
 * Redirect follow — sends one request under its redirect policy (N2).
 * `follow` hands the request to fetch untouched; `reject` asks fetch not to
 * follow and refuses any 3xx; a manual policy follows only 301/302/303/307/308
 * hops whose Location resolves to an allowed URL, at most `maxHops` times.
 * Every hop is a body-less GET through the same transport seam, so each hop
 * keeps the per-request cap. A hop's Set-Cookie lines are filed under the hop
 * URL before the next hop is built, and each hop's Cookie header is computed
 * for the hop URL — the first request's header is never reused. Location
 * values are never logged and never put in a failure message.
 */

import { ScraperErrorTypes } from '../../../Base/ErrorTypes.js';
import type { Brand } from '../../Types/Brand.js';
import type { IManualRedirect, IUrlRule, RedirectPolicy } from '../../Types/Domain/FetchPolicy.js';
import { REDIRECT_REFUSED_REASON } from '../../Types/Domain/FetchPolicy.js';
import type { Option } from '../../Types/Option.js';
import { none, some } from '../../Types/Option.js';
import type { Procedure } from '../../Types/Procedure.js';
import { fail, isOk, succeed } from '../../Types/Procedure.js';
import type { FetchInvoke, HttpVerb, OnSetCookie } from './FetchStrategy.js';
import { safeUrlForLog } from './SafeUrlForLog.js';
import { matchesAnyUrlRule } from './UrlRule.js';

type SetCookieEmitCount = Brand<number, 'SetCookieEmitCount'>;

/** One request, its transport seam and the redirect policy it runs under. */
interface IRedirectRun {
  readonly url: string;
  readonly init: RequestInit;
  readonly verb: HttpVerb;
  readonly invoke: FetchInvoke;
  readonly policy: RedirectPolicy;
  readonly onSetCookie?: OnSetCookie;
  readonly cookieHeaderFor?: (url: string) => Option<string>;
}

/** The response that ended a run and the URL its Set-Cookie lines belong to. */
interface IRunEnd {
  readonly response: Response;
  readonly responseUrl: string;
}

/** One request of a manual run and the hops still allowed after it. */
interface IHop {
  readonly url: string;
  readonly init: RequestInit;
  readonly verb: HttpVerb;
  readonly hopsLeft: number;
}

/** A manual run and the rules its hops must match. */
interface IManualRun {
  readonly run: IRedirectRun;
  readonly rules: readonly IUrlRule[];
}

/** Sends one run under a fixed (string) policy. */
type Sender = (run: IRedirectRun) => Promise<Procedure<IRunEnd>>;

/** Redirect statuses a manual policy may follow. */
const FOLLOWED_STATUSES: ReadonlySet<number> = new Set([301, 302, 303, 307, 308]);

/**
 * Whether a status is a redirect.
 * @param status - HTTP status.
 * @returns True for any 3xx.
 */
function isRedirectStatus(status: number): boolean {
  return status >= 300 && status < 400;
}

/**
 * The URL a response's cookies belong to: its own, else the request's.
 * @param response - The response.
 * @param requestUrl - The URL that was requested.
 * @returns The answering URL.
 */
function answeredUrl(response: Response, requestUrl: string): string {
  if (response.url === '') return requestUrl;
  return response.url;
}

/**
 * Hand a response's raw Set-Cookie lines (Node 18+ `getSetCookie`, which
 * keeps multi-value headers apart) to the hook, when there is one.
 * @param response - Raw fetch Response.
 * @param responseUrl - URL the lines are filed under.
 * @param hook - Optional caller-supplied callback.
 * @returns Number of lines emitted (0 with no hook or no cookies).
 */
function emitSetCookies(
  response: Response,
  responseUrl: string,
  hook?: OnSetCookie,
): SetCookieEmitCount {
  const list = response.headers.getSetCookie();
  if (!hook || list.length === 0) return 0 as SetCookieEmitCount;
  hook(list, responseUrl);
  return list.length as SetCookieEmitCount;
}

/**
 * Refuse a manual run without naming the refused target.
 * @param run - The run.
 * @returns Generic failure naming only the request URL.
 */
function refused(run: IRedirectRun): Procedure<IRunEnd> {
  const safeUrl = safeUrlForLog(run.url);
  return fail(ScraperErrorTypes.Generic, `${run.verb} ${safeUrl} ${REDIRECT_REFUSED_REASON}`);
}

/**
 * Send the request as-is; fetch follows any redirect itself.
 * @param run - The run.
 * @returns The response, or the transport failure.
 */
async function sendFollow(run: IRedirectRun): Promise<Procedure<IRunEnd>> {
  const sent = await run.invoke(run.url, run.init, run.verb);
  if (!isOk(sent)) return sent;
  return succeed({ response: sent.value, responseUrl: sent.value.url });
}

/**
 * Send the request without following, and refuse any 3xx.
 * @param run - The run.
 * @returns The response, a refusal, or the transport failure.
 */
async function sendReject(run: IRedirectRun): Promise<Procedure<IRunEnd>> {
  const sent = await run.invoke(run.url, { ...run.init, redirect: 'manual' }, run.verb);
  if (!isOk(sent)) return sent;
  const { status, url } = sent.value;
  if (!isRedirectStatus(status)) return succeed({ response: sent.value, responseUrl: url });
  const safeUrl = safeUrlForLog(run.url);
  const message = `${run.verb} ${safeUrl} HTTP ${String(status)} ${REDIRECT_REFUSED_REASON}`;
  return fail(ScraperErrorTypes.Generic, message);
}

/** Sender per fixed policy. */
const FIXED_SENDERS: Readonly<Record<'follow' | 'reject', Sender>> = {
  follow: sendFollow,
  reject: sendReject,
};

/**
 * Hop headers: the first request's, minus its Cookie, plus the hop's own.
 * @param init - The first request's init.
 * @param cookie - Cookie header for the hop URL, if any.
 * @returns Header record for the hop.
 */
function hopHeaders(init: RequestInit, cookie: Option<string>): Record<string, string> {
  const headers = new Headers(init.headers);
  headers.delete('cookie');
  if (cookie.has) headers.set('cookie', cookie.value);
  return Object.fromEntries(headers);
}

/**
 * The allowed target a redirect points at.
 * @param response - The redirect response.
 * @param hop - The request that drew it.
 * @param rules - Allowed targets.
 * @returns The target, or none when the redirect may not be followed.
 */
function hopTarget(response: Response, hop: IHop, rules: readonly IUrlRule[]): Option<URL> {
  if (hop.hopsLeft < 1 || !FOLLOWED_STATUSES.has(response.status)) return none();
  const location = response.headers.get('location');
  if (location === null || !URL.canParse(location, hop.url)) return none();
  const target = new URL(location, hop.url);
  if (!matchesAnyUrlRule(target, rules)) return none();
  return some(target);
}

/**
 * Build the body-less GET for an allowed target.
 * @param run - The run.
 * @param hop - The request that redirected.
 * @param target - Allowed target.
 * @returns The next hop.
 */
function nextHop(run: IRedirectRun, hop: IHop, target: URL): IHop {
  const url = target.href;
  const cookie = run.cookieHeaderFor ? run.cookieHeaderFor(url) : none();
  const headers = hopHeaders(run.init, cookie);
  const init: RequestInit = { method: 'GET', headers, redirect: 'manual' };
  return { url, init, verb: 'GET', hopsLeft: hop.hopsLeft - 1 };
}

/**
 * Send one request of a manual run and follow it while it redirects.
 * @param ctx - The run and its rules.
 * @param hop - The request to send.
 * @returns The final response, a refusal, or the transport failure.
 */
async function sendHop(ctx: IManualRun, hop: IHop): Promise<Procedure<IRunEnd>> {
  const sent = await ctx.run.invoke(hop.url, hop.init, hop.verb);
  if (!isOk(sent)) return sent;
  const response = sent.value;
  const responseUrl = answeredUrl(response, hop.url);
  if (!isRedirectStatus(response.status)) return succeed({ response, responseUrl });
  return continueHop(ctx, hop, { response, responseUrl });
}

/**
 * File a redirect's cookies, then send the next hop or refuse the run.
 * @param ctx - The run and its rules.
 * @param hop - The request that redirected.
 * @param end - The redirect and the URL it answered.
 * @returns The final response, a refusal, or the transport failure.
 */
async function continueHop(ctx: IManualRun, hop: IHop, end: IRunEnd): Promise<Procedure<IRunEnd>> {
  emitSetCookies(end.response, end.responseUrl, ctx.run.onSetCookie);
  const target = hopTarget(end.response, hop, ctx.rules);
  if (!target.has) return refused(ctx.run);
  const next = nextHop(ctx.run, hop, target.value);
  return sendHop(ctx, next);
}

/**
 * Run a request under a manual policy.
 * @param run - The run.
 * @param policy - Hop budget and allowed targets.
 * @returns The final response, a refusal, or the transport failure.
 */
function sendManual(run: IRedirectRun, policy: IManualRedirect): Promise<Procedure<IRunEnd>> {
  const init: RequestInit = { ...run.init, redirect: 'manual' };
  const first: IHop = { url: run.url, init, verb: run.verb, hopsLeft: policy.maxHops };
  return sendHop({ run, rules: policy.allow }, first);
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
export type { IRedirectRun, IRunEnd };
export { emitSetCookies, sendUnderPolicy };
