/**
 * Mizrahi synthetic fetch mock — stands in for www and mto so the browserless
 * login and scrape run with no network.
 *
 * Rule #18: every value here is SYNTHETIC. No real PII.
 *
 * Login, counted as `identity`:
 *   GET  www /login/index.html             → XSRF-TOKEN (parent domain) + a www-only session
 *   POST www /login/api/Login/LoginUser    {Username, Password} → ReturnCode, the auth cookie
 *   GET  mto /Online/Default.aspx?language → 302 → 302 → 200, one host-only cookie per hop
 *   POST mto /Online/api/SkyBL/logon       → xsrfToken + Accounts, `skyserid` header
 * Data, counted as `graphql`:
 *   POST mto /Online/api/SkyBL/changeAccount {selectedAccountIndex} → switches the account
 *   POST mto /Online/api/SkyOSH/get428Index  → the switched account's rows
 *
 * The mock enforces what the bank enforces, so a broken request fails here
 * too: LoginUser needs both www cookies and the decoded X-XSRF-TOKEN; the
 * landing needs the auth cookie; logon needs every hop cookie; data calls
 * need the auth cookie and the composed `mizrahixsrftoken`.
 */

import type { JsonUnknownRecord } from '../../../Scrapers/Pipeline/Types/JsonValue.js';
import type {
  CallKind,
  IMockHandle,
  IRecordedCall,
  NetworkFault,
} from '../Helpers/FetchMockKit.js';
import {
  errorReply,
  installFetchMock,
  NETWORK_FAULTS,
  parseBody,
} from '../Helpers/FetchMockKit.js';
import {
  logonAccounts,
  MIZRAHI_MOCK_ACCOUNTS,
  MIZRAHI_MOCK_CREDS,
  MZ_AUTH_COOKIE,
  MZ_DATA_TOKEN,
  MZ_DATA_TOKEN_NO_SKY,
  MZ_HOP_COOKIES,
  MZ_LANDING_PATH,
  MZ_LANDING_URL,
  MZ_LOGON_XSRF,
  MZ_MTO,
  MZ_SKYSERID,
  MZ_WEB,
  MZ_WEB_SESSION,
  MZ_XSRF_COOKIE,
  MZ_XSRF_DECODED,
  rowsOf,
} from './MizrahiMockData.js';

/** How the mock misbehaves: a step-0 fault, a login refusal, a wire fault. */
export type MizrahiFault =
  | 'none'
  | NetworkFault
  | 'changePassword'
  | 'blocked'
  | 'code19'
  | 'code8'
  | 'login307'
  | 'landingLoop'
  | 'foreignLocation'
  | 'extraQuery'
  | 'noSkyserid'
  | 'logonNoXsrf'
  | 'txns204'
  | 'expire401';

/** The text a logon without `xsrfToken` carries; it must never surface. */
export const MZ_BANK_NOTICE = 'SYNTHETIC bank notice 7731';

/** Where a 307 on LoginUser would replay the credentials. */
export const MZ_LOGIN_REPLAY_URL = `${MZ_WEB}/login/api/Login/LoginUser?replay=1`;

/** One run's mutable state: the account changeAccount last selected. */
interface IMockRun {
  readonly fault: MizrahiFault;
  readonly selected: number[];
}

/** One route: answers a recorded call within a run. */
type Route = (call: IRecordedCall, run: IMockRun) => Response;

/** What a reply carries besides its status and body. */
interface IReplyExtras {
  readonly setCookies?: readonly string[];
  readonly headers?: Readonly<Record<string, string>>;
}

const PARENT_SCOPE = '; Domain=.mizrahi-tefahot.co.il; Path=/; Secure';
const HOST_SCOPE = '; Path=/; HttpOnly; Secure';
const HOP_SCOPE = '; Path=/Online; HttpOnly; Secure';
const HTML = { 'content-type': 'text/html' };
const PAGE = '<html><body>SYNTHETIC Mizrahi page</body></html>';

/** The 307 a replay fault answers LoginUser with. */
const REPLAY_REDIRECT: IReplyExtras = { headers: { location: MZ_LOGIN_REPLAY_URL } };

/** The response header logon carries the session id in. */
const SKYSERID_HEADER: Readonly<Record<string, string>> = { skyserid: MZ_SKYSERID };

/** The ReturnCode a fault forces, overriding the credential check. */
const FAULT_RETURN_CODE: Partial<Record<MizrahiFault, number>> = {
  changePassword: 4,
  blocked: 5,
  code19: 19,
  code8: 8,
};

/** Where each landing-redirect fault points. */
const LANDING_FAULT_TARGET: Partial<Record<MizrahiFault, string>> = {
  foreignLocation: 'https://www.example.com/Online/Default.aspx',
  extraQuery: `${MZ_LANDING_URL}&next=1`,
};

/** Data endpoints, counted apart from the login calls. */
const DATA_PATHS: ReadonlySet<string> = new Set([
  '/Online/api/SkyBL/changeAccount',
  '/Online/api/SkyOSH/get428Index',
]);

/**
 * The headers a synthetic reply carries.
 * @param extras - Set-Cookie lines and headers.
 * @returns The response headers.
 */
function headersOf(extras: IReplyExtras): Headers {
  const headers = new Headers(extras.headers);
  for (const line of extras.setCookies ?? []) headers.append('set-cookie', line);
  return headers;
}

/**
 * A synthetic reply with a body.
 * @param status - HTTP status.
 * @param body - Body text.
 * @param extras - Set-Cookie lines and headers.
 * @returns The response.
 */
function reply(status: number, body: string, extras: IReplyExtras = {}): Response {
  const headers = headersOf(extras);
  return new Response(body, { status, headers });
}

/**
 * A synthetic reply with no body (a redirect or a 204).
 * @param status - HTTP status.
 * @param extras - Set-Cookie lines and headers.
 * @returns The response.
 */
function bodiless(status: number, extras: IReplyExtras = {}): Response {
  const headers = headersOf(extras);
  return new Response(null, { status, headers });
}

/**
 * A 200 JSON reply.
 * @param payload - JSON body.
 * @param extras - Set-Cookie lines and headers.
 * @returns The response.
 */
function json(payload: JsonUnknownRecord, extras: IReplyExtras = {}): Response {
  const headers = { 'content-type': 'application/json', ...extras.headers };
  const text = JSON.stringify(payload);
  return reply(200, text, { ...extras, headers });
}

/**
 * A 302 to a location.
 * @param location - Location header value.
 * @param setCookies - Set-Cookie lines the hop sets.
 * @returns The response.
 */
function redirectTo(location: string, setCookies: readonly string[] = []): Response {
  return bodiless(302, { headers: { location }, setCookies });
}

/**
 * The cookie pairs a call sent.
 * @param call - The recorded request.
 * @returns Each `name=value` pair of its Cookie header.
 */
export function cookiesOf(call: IRecordedCall): readonly string[] {
  return (call.headers.get('cookie') ?? '').split('; ');
}

/**
 * Whether a call sent every pair.
 * @param call - The recorded request.
 * @param pairs - `name=value` pairs to look for.
 * @returns True when the Cookie header holds all of them.
 */
function hasCookies(call: IRecordedCall, pairs: readonly string[]): boolean {
  const sent = cookiesOf(call);
  return pairs.every(pair => sent.includes(pair));
}

/**
 * bootstrap — the login page, setting both www cookies.
 * @returns The page.
 */
function routeBootstrap(): Response {
  const setCookies = [`${MZ_XSRF_COOKIE}${PARENT_SCOPE}`, `${MZ_WEB_SESSION}${HOST_SCOPE}`];
  return reply(200, PAGE, { headers: HTML, setCookies });
}

/**
 * The ReturnCode a login body earns.
 * @param body - Parsed LoginUser body.
 * @param fault - Fault the mock answers with.
 * @returns 1 for the synthetic credentials, 2 for any other, or the fault's code.
 */
function returnCodeOf(body: JsonUnknownRecord, fault: MizrahiFault): number {
  const forced = FAULT_RETURN_CODE[fault];
  if (forced !== undefined) return forced;
  const isKnownUser = body.Username === MIZRAHI_MOCK_CREDS.username;
  const isRightPassword = body.Password === MIZRAHI_MOCK_CREDS.password;
  return isKnownUser && isRightPassword ? 1 : 2;
}

/**
 * Whether LoginUser got both www cookies and the decoded XSRF header.
 * @param call - The recorded request.
 * @returns True when the anti-forgery pair matches.
 */
function hasLoginGuard(call: IRecordedCall): boolean {
  const isTokenSent = call.headers.get('x-xsrf-token') === MZ_XSRF_DECODED;
  return isTokenSent && hasCookies(call, [MZ_XSRF_COOKIE, MZ_WEB_SESSION]);
}

/**
 * LoginUser — the ReturnCode, with the parent-domain auth cookie on success.
 * @param call - The recorded request.
 * @param run - The run's state.
 * @returns The outcome; 403 without the guard; 307 for the replay fault.
 */
function routeLogin(call: IRecordedCall, run: IMockRun): Response {
  if (run.fault === 'login307') return bodiless(307, REPLAY_REDIRECT);
  if (!hasLoginGuard(call)) return errorReply(403);
  const body = parseBody(call.body);
  const code = returnCodeOf(body, run.fault);
  const setCookies = code === 1 ? [`${MZ_AUTH_COOKIE}${PARENT_SCOPE}`] : [];
  return json({ ReturnCode: code }, { setCookies });
}

/**
 * The landing chain: `?language` → plain (hop 1) → `?language` (hop 2) → page.
 * @param call - The recorded request.
 * @returns The next redirect, setting that hop's cookie, or the page.
 */
function landingChain(call: IRecordedCall): Response {
  const hops = MZ_HOP_COOKIES.filter(pair => cookiesOf(call).includes(pair)).length;
  if (hops >= MZ_HOP_COOKIES.length) return reply(200, PAGE, { headers: HTML });
  const location = hops === 0 ? MZ_LANDING_PATH : MZ_LANDING_URL;
  return redirectTo(location, [`${MZ_HOP_COOKIES[hops]}${HOP_SCOPE}`]);
}

/**
 * The other landing URL — a loop between the two allowed forms.
 * @param url - The URL just asked for.
 * @returns The plain URL for the `?language` one, else the `?language` one.
 */
function otherLanding(url: string): string {
  return url.includes('?') ? `${MZ_MTO}${MZ_LANDING_PATH}` : MZ_LANDING_URL;
}

/**
 * Landing — needs the auth cookie, then walks the chain or a fault's redirect.
 * @param call - The recorded request.
 * @param run - The run's state.
 * @returns The hop's answer; 401 without the auth cookie.
 */
function routeLanding(call: IRecordedCall, run: IMockRun): Response {
  if (!hasCookies(call, [MZ_AUTH_COOKIE])) return errorReply(401);
  const faultTarget = LANDING_FAULT_TARGET[run.fault];
  if (faultTarget !== undefined) return redirectTo(faultTarget);
  if (run.fault !== 'landingLoop') return landingChain(call);
  const loopTarget = otherLanding(call.url);
  return redirectTo(loopTarget);
}

/**
 * logon — needs the auth cookie and every hop cookie.
 * @param call - The recorded request.
 * @param run - The run's state.
 * @returns The accounts and xsrfToken, with `skyserid` unless the fault drops it.
 */
function routeLogon(call: IRecordedCall, run: IMockRun): Response {
  if (!hasCookies(call, [MZ_AUTH_COOKIE, ...MZ_HOP_COOKIES])) return errorReply(401);
  const user = { Accounts: logonAccounts() };
  if (run.fault === 'logonNoXsrf') return json({ message: MZ_BANK_NOTICE, body: { user } });
  const headers = run.fault === 'noSkyserid' ? {} : SKYSERID_HEADER;
  return json({ body: { xsrfToken: MZ_LOGON_XSRF, user } }, { headers });
}

/**
 * Whether a data call carries the auth cookie and the composed token.
 * @param call - The recorded request.
 * @param run - The run's state.
 * @returns True when the session is valid.
 */
function isDataAuthorised(call: IRecordedCall, run: IMockRun): boolean {
  const token = run.fault === 'noSkyserid' ? MZ_DATA_TOKEN_NO_SKY : MZ_DATA_TOKEN;
  const isTokenRight = call.headers.get('mizrahixsrftoken') === token;
  return isTokenRight && hasCookies(call, [MZ_AUTH_COOKIE]);
}

/**
 * changeAccount — switches the session to an account and returns its balance.
 * @param call - The recorded request.
 * @param run - The run's state.
 * @returns The account's number and balance; 400 for an unknown index.
 */
function routeChangeAccount(call: IRecordedCall, run: IMockRun): Response {
  const index = parseBody(call.body).selectedAccountIndex;
  const account = typeof index === 'number' ? MIZRAHI_MOCK_ACCOUNTS.at(index) : undefined;
  if (typeof index !== 'number' || account === undefined) return errorReply(400);
  run.selected.splice(0, 1, index);
  return json({ body: { SnifAndNumber400: account.number, YitraAdkanit: account.balance } });
}

/**
 * get428Index — the switched account's rows, or a fault's answer.
 * @param _call - The recorded request.
 * @param run - The run's state.
 * @returns One page of rows; 204 or 401 for its faults.
 */
function routeTxns(_call: IRecordedCall, run: IMockRun): Response {
  if (run.fault === 'txns204') return bodiless(204);
  if (run.fault === 'expire401') return errorReply(401);
  const [account] = MIZRAHI_MOCK_ACCOUNTS.slice(run.selected[0]);
  const table = { rows: rowsOf(account), isHasMoreRows: false, actionGUID: 'syn-mz-guid' };
  return json({ body: { fields: { AccountNumber: account.number }, table } });
}

/**
 * Guard a data route behind the session check.
 * @param route - The data route.
 * @returns A route answering 401 without a valid session.
 */
function withDataGuard(route: Route): Route {
  return (call: IRecordedCall, run: IMockRun): Response =>
    isDataAuthorised(call, run) ? route(call, run) : errorReply(401);
}

/** Routes keyed by `<METHOD> <origin><path>`. */
const ROUTES: Readonly<Partial<Record<string, Route>>> = {
  [`GET ${MZ_WEB}/login/index.html`]: routeBootstrap,
  [`POST ${MZ_WEB}/login/api/Login/LoginUser`]: routeLogin,
  [`GET ${MZ_MTO}${MZ_LANDING_PATH}`]: routeLanding,
  [`POST ${MZ_MTO}/Online/api/SkyBL/logon`]: routeLogon,
  [`POST ${MZ_MTO}/Online/api/SkyBL/changeAccount`]: withDataGuard(routeChangeAccount),
  [`POST ${MZ_MTO}/Online/api/SkyOSH/get428Index`]: withDataGuard(routeTxns),
};

/**
 * The route key of a call.
 * @param call - The recorded request.
 * @returns `<METHOD> <origin><path>`.
 */
function routeKeyOf(call: IRecordedCall): string {
  const { origin, pathname } = new URL(call.url);
  return `${call.method} ${origin}${pathname}`;
}

/**
 * The tally a call counts toward.
 * @param call - The recorded request.
 * @returns `graphql` for a data call, `identity` for any other bank call.
 */
export function classifyMizrahi(call: IRecordedCall): CallKind {
  const { origin, pathname } = new URL(call.url);
  if (origin !== MZ_WEB && origin !== MZ_MTO) return 'other';
  return DATA_PATHS.has(pathname) ? 'graphql' : 'identity';
}

/**
 * Whether a fault is a transport failure.
 * @param fault - Fault the mock answers with.
 * @returns True for the kit's network faults.
 */
function isNetworkFault(fault: MizrahiFault): fault is NetworkFault {
  return fault in NETWORK_FAULTS;
}

/**
 * Route one request; a network fault lands on step 0.
 * @param call - The recorded request.
 * @param run - The run's state.
 * @returns The bank's answer; 404 for anything else.
 */
function answerMizrahi(call: IRecordedCall, run: IMockRun): Promise<Response> {
  const route = ROUTES[routeKeyOf(call)] ?? ((): Response => errorReply(404));
  const isStepZero = route === routeBootstrap;
  if (isStepZero && isNetworkFault(run.fault)) return NETWORK_FAULTS[run.fault]();
  const response = route(call, run);
  return Promise.resolve(response);
}

/**
 * Install the synthetic www + mto over globalThis.fetch.
 * @param fault - Fault the mock answers with; `'none'` behaves normally.
 * @returns Handle with dispose, call counts and the call log.
 */
export function installMizrahiFetchMock(fault: MizrahiFault = 'none'): IMockHandle {
  const run: IMockRun = { fault, selected: [0] };
  return installFetchMock({
    classify: classifyMizrahi,
    /**
     * Answer one call.
     * @param call - The recorded request.
     * @returns The bank's answer.
     */
    answer: (call: IRecordedCall): Promise<Response> => answerMizrahi(call, run),
  });
}
