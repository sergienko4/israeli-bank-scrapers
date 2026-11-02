/**
 * Beinleumi mocked portal routes (spec §11.2 rows 1 and 5–8): the login page,
 * the form post whose page hands off to the portal, the hand-off and its one
 * redirect, the SSO code, and the authorization header the code buys. The
 * portal keeps its session in cookies, so each later call must echo them.
 *
 * Rule #18: every value here is SYNTHETIC. No real PII.
 */

import { isDeepStrictEqual } from 'node:util';

import type { IRecordedCall } from '../Helpers/FetchMockKit.js';
import { errorReply, parseBody, parseForm } from '../Helpers/FetchMockKit.js';
import { bodiless, hasCookies, redirectTo, reply } from '../Helpers/MockReplies.js';
import type { IFibiMockBrand } from './BeinleumiBrands.js';
import { entryQueryOf, entryUrlOf, landingUrlOf } from './BeinleumiBrands.js';
import type { IBeinleumiMockState, Route } from './BeinleumiFaults.js';
import { checkWire, headerChecks, hit, isQueryExactly } from './BeinleumiFaults.js';
import {
  BEINLEUMI_MOCK_CREDS,
  BN_AUTHORIZATION,
  BN_HANDOFF_PATH,
  BN_HANDOFF_RID,
  BN_LANDING_COOKIE,
  BN_LANDING_PATH,
  BN_PORTAL_COOKIE,
  BN_SSO_CODE,
  BN_TOKEN,
} from './BeinleumiMockData.js';
import { formFieldsOf, handoffPage, LANDING_PAGE, loginPage } from './BeinleumiPages.js';
import { HTML_TYPE, PAGE_ACCEPT, WIRE_PATHS, WIRE_UA } from './BeinleumiWireSpec.js';

export const UUID = /^[\da-f]{8}-[\da-f]{4}-4[\da-f]{3}-[89ab][\da-f]{3}-[\da-f]{12}$/;

const PAGE_HEADERS = { accept: PAGE_ACCEPT, 'user-agent': WIRE_UA };
const FORM_TYPE = 'application/x-www-form-urlencoded;charset=UTF-8';
const PORTAL_COOKIES = [BN_PORTAL_COOKIE, BN_LANDING_COOKIE];

/**
 * The headers the login form is posted with, from the login page.
 * @param brand - The bank.
 * @returns The headers.
 */
function logonHeadersOf(brand: IFibiMockBrand): Record<string, string> {
  const sender = { origin: brand.origin, referer: entryUrlOf(brand) };
  return { ...PAGE_HEADERS, ...sender, 'content-type': FORM_TYPE };
}

/**
 * The login form as the client must post it: the user and the Transmit token.
 * @param brand - The bank.
 * @returns The form fields.
 */
function logonFormOf(brand: IFibiMockBrand): Record<string, string> {
  const filled = { user: BEINLEUMI_MOCK_CREDS.username, passwordEnc: BN_TOKEN };
  return { ...formFieldsOf(brand), ...filled };
}

/**
 * The headers the portal shell sends its SSO calls with, from the landing.
 * @param brand - The bank.
 * @returns The headers.
 */
function ssoHeadersOf(brand: IFibiMockBrand): Record<string, string> {
  const sender = { origin: brand.origin, referer: landingUrlOf(brand) };
  return { accept: 'application/json', 'user-agent': WIRE_UA, ...sender };
}

/**
 * Where the SSO answer sends the shell: its code rides the query.
 * @param brand - The bank.
 * @returns The callback URL.
 */
function ssoCallbackOf(brand: IFibiMockBrand): string {
  return `${brand.origin}/appsng/shell/callback?code=${BN_SSO_CODE}`;
}

/**
 * A 200 HTML page.
 * @param body - The page.
 * @param setCookies - Set-Cookie lines it sends.
 * @returns The response.
 */
function html(body: string, setCookies: readonly string[] = []): Response {
  return reply(200, body, {
    headers: { 'content-type': `${HTML_TYPE}; charset=UTF-8` },
    setCookies,
  });
}

/**
 * The checks a portal page call must pass: its headers, query and cookies.
 * @param call - The call checked.
 * @param query - The exact query it names.
 * @param cookies - The cookies it must echo.
 * @returns The checks.
 */
function pageChecks(
  call: IRecordedCall,
  query: Readonly<Record<string, string>>,
  cookies: readonly string[],
): Record<string, boolean> {
  const headers = headerChecks(call, PAGE_HEADERS);
  return { ...headers, query: isQueryExactly(call, query), cookies: hasCookies(call, cookies) };
}

/**
 * The login page, setting the portal session.
 * @param call - The request.
 * @param state - Run state.
 * @returns The page, or a 400 when the request is off spec.
 */
function prime(call: IRecordedCall, state: IBeinleumiMockState): Response {
  hit(state, 'prime');
  const headers = headerChecks(call, { accept: HTML_TYPE, 'user-agent': WIRE_UA });
  const query = entryQueryOf(state.brand);
  const isQuery = isQueryExactly(call, query);
  if (!checkWire(state, call, { ...headers, query: isQuery })) return errorReply(400);
  const page = loginPage(state.fault, state.brand);
  return html(page, [`${BN_PORTAL_COOKIE}; Path=/; Secure; HttpOnly`]);
}

/**
 * The login form posted back, its password the Transmit token.
 * @param call - The request.
 * @param state - Run state.
 * @returns The hand-off page, or a 400 when the request is off spec.
 */
function logon(call: IRecordedCall, state: IBeinleumiMockState): Response {
  hit(state, 'logon');
  const form = parseForm(call.body);
  const expected = logonFormOf(state.brand);
  const checks = {
    ...pageChecks(call, {}, [BN_PORTAL_COOKIE]),
    form: isDeepStrictEqual(form, expected),
  };
  const wanted = logonHeadersOf(state.brand);
  const headers = headerChecks(call, wanted);
  if (!checkWire(state, call, { ...checks, ...headers })) return errorReply(400);
  const page = handoffPage(state.fault);
  return html(page);
}

/**
 * The portal home the hand-off names: one redirect to the landing.
 * @param call - The request.
 * @param state - Run state.
 * @returns The redirect, or a 400 when the request is off spec.
 */
function landing(call: IRecordedCall, state: IBeinleumiMockState): Response {
  hit(state, 'landing');
  const checks = pageChecks(call, { rid: BN_HANDOFF_RID }, [BN_PORTAL_COOKIE]);
  if (!checkWire(state, call, checks)) return errorReply(400);
  return redirectTo(BN_LANDING_PATH, [`${BN_LANDING_COOKIE}; Path=/; Secure`]);
}

/**
 * The landing page.
 * @param call - The request.
 * @param state - Run state.
 * @returns The page, or a 400 when the request is off spec.
 */
function landed(call: IRecordedCall, state: IBeinleumiMockState): Response {
  hit(state, 'landed');
  const checks = pageChecks(call, {}, PORTAL_COOKIES);
  if (!checkWire(state, call, checks)) return errorReply(400);
  return html(LANDING_PAGE);
}

/**
 * The SSO bootstrap: the shell's name in, the callback naming the code out.
 * @param call - The request.
 * @param state - Run state.
 * @returns The callback text, a 204 under its fault, or a 400 off spec.
 */
function bootstrap(call: IRecordedCall, state: IBeinleumiMockState): Response {
  hit(state, 'bootstrap');
  const body = parseBody(call.body);
  const isBody = isDeepStrictEqual(body, { TPPName: 'shell' });
  const sso = ssoHeadersOf(state.brand);
  const headers = headerChecks(call, { ...sso, 'content-type': 'application/json' });
  const checks = { ...headers, body: isBody, cookies: hasCookies(call, PORTAL_COOKIES) };
  if (!checkWire(state, call, checks)) return errorReply(400);
  if (state.fault === 'sso204') return bodiless(204);
  const callback = ssoCallbackOf(state.brand);
  return reply(200, callback, { headers: { 'content-type': 'text/plain' } });
}

/**
 * The authorization the SSO code buys, in a header.
 * @param call - The request.
 * @param state - Run state.
 * @returns The answer, or a 400 when the request is off spec.
 */
function sessionToken(call: IRecordedCall, state: IBeinleumiMockState): Response {
  hit(state, 'sessionToken');
  const isCode = new URL(call.url).search === `?code=${BN_SSO_CODE}`;
  const isTxnId = UUID.test(call.headers.get('x-fibi-transaction-id') ?? '');
  const sso = {
    code: isCode,
    'transaction id': isTxnId,
    cookies: hasCookies(call, PORTAL_COOKIES),
  };
  const wanted = ssoHeadersOf(state.brand);
  const headers = headerChecks(call, wanted);
  if (!checkWire(state, call, { ...headers, ...sso })) return errorReply(400);
  return reply(200, '{}', { headers: { authorization: BN_AUTHORIZATION } });
}

export const PORTAL_ROUTES: Readonly<Record<string, Route>> = {
  [`GET ${WIRE_PATHS.servlet}`]: prime,
  [`POST ${WIRE_PATHS.servlet}`]: logon,
  [`GET ${BN_HANDOFF_PATH}`]: landing,
  [`GET ${BN_LANDING_PATH}`]: landed,
  [`POST ${WIRE_PATHS.bootstrap}`]: bootstrap,
  [`GET ${WIRE_PATHS.authorize}`]: sessionToken,
};
