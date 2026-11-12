/**
 * Beinleumi mocked portal routes: the login-form post that hands the Transmit
 * token to the servlet, the SSO code, and the authorization header the code
 * buys. The servlet keeps the session in cookies, so each later call must echo
 * them. No page is read before the post.
 *
 * Rule #18: every value here is SYNTHETIC. No real PII.
 */

import { isDeepStrictEqual } from 'node:util';

import type { IRecordedCall } from '../Helpers/FetchMockKit.js';
import { errorReply, parseBody, parseForm } from '../Helpers/FetchMockKit.js';
import { bodiless, hasCookies, reply } from '../Helpers/MockReplies.js';
import type { IFibiMockBrand } from './BeinleumiBrands.js';
import { entryUrlOf } from './BeinleumiBrands.js';
import type { IBeinleumiMockState, Route } from './BeinleumiFaults.js';
import { checkWire, headerChecks, hit, isQueryExactly } from './BeinleumiFaults.js';
import {
  BEINLEUMI_MOCK_CREDS,
  BN_AUTHORIZATION,
  BN_LANDING_COOKIE,
  BN_PORTAL_COOKIE,
  BN_SSO_CODE,
  BN_TOKEN,
} from './BeinleumiMockData.js';
import { formFieldsOf, logonPage } from './BeinleumiPages.js';
import { HTML_TYPE, PAGE_ACCEPT, WIRE_PATHS, WIRE_UA } from './BeinleumiWireSpec.js';

export const UUID = /^[\da-f]{8}-[\da-f]{4}-4[\da-f]{3}-[89ab][\da-f]{3}-[\da-f]{12}$/;

const PAGE_HEADERS = { accept: PAGE_ACCEPT, 'user-agent': WIRE_UA };
const FORM_TYPE = 'application/x-www-form-urlencoded;charset=UTF-8';
const PORTAL_COOKIES = [BN_PORTAL_COOKIE, BN_LANDING_COOKIE];

/**
 * The headers the login form is posted with, from the brand entry URL.
 * @param brand - The bank.
 * @returns The headers.
 */
function logonHeadersOf(brand: IFibiMockBrand): Record<string, string> {
  const sender = { origin: brand.origin, referer: entryUrlOf(brand) };
  return { ...PAGE_HEADERS, ...sender };
}

/**
 * The login form as the client must post it: the static fields, the user and
 * the Transmit token.
 * @param brand - The bank.
 * @returns The form fields.
 */
function logonFormOf(brand: IFibiMockBrand): Record<string, string> {
  const filled = { user: BEINLEUMI_MOCK_CREDS.username, passwordEnc: BN_TOKEN };
  return { ...formFieldsOf(brand), ...filled };
}

/**
 * The headers the portal shell sends its SSO calls with.
 * @param brand - The bank.
 * @returns The headers.
 */
function ssoHeadersOf(brand: IFibiMockBrand): Record<string, string> {
  const sender = { origin: brand.origin, referer: entryUrlOf(brand) };
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
 * The login form posted back, its password the Transmit token. The answer
 * sets the portal session; there is no hand-off to follow.
 * @param call - The request.
 * @param state - Run state.
 * @returns The portal page, or a 400 when the request is off spec.
 */
function logon(call: IRecordedCall, state: IBeinleumiMockState): Response {
  hit(state, 'logon');
  const form = parseForm(call.body);
  const expected = logonFormOf(state.brand);
  const wanted = logonHeadersOf(state.brand);
  const formHeaders = headerChecks(call, { ...PAGE_HEADERS, 'content-type': FORM_TYPE });
  const checks = {
    ...formHeaders,
    ...headerChecks(call, wanted),
    form: isDeepStrictEqual(form, expected),
    query: isQueryExactly(call, {}),
  };
  if (!checkWire(state, call, checks)) return errorReply(400);
  const page = logonPage();
  return html(page, [
    `${BN_PORTAL_COOKIE}; Path=/; Secure; HttpOnly`,
    `${BN_LANDING_COOKIE}; Path=/; Secure`,
  ]);
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
  [`POST ${WIRE_PATHS.servlet}`]: logon,
  [`POST ${WIRE_PATHS.bootstrap}`]: bootstrap,
  [`GET ${WIRE_PATHS.authorize}`]: sessionToken,
};
