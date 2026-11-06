/**
 * Discount login routes — the login page, the key, the sealed login, its
 * success hop and the retail landing, each answering as the bank does or as
 * the run's fault dictates.
 *
 * Rule #18: every value here is SYNTHETIC. No real PII.
 */

import { openPkcs1 } from '../../Helpers/SealOpener.js';
import type { IRecordedCall } from '../Helpers/FetchMockKit.js';
import { errorReply, parseBody } from '../Helpers/FetchMockKit.js';
import { bodiless, hasCookies, json, redirectTo, reply } from '../Helpers/MockReplies.js';
import type { DiscountFault, IDiscountMockRun, Route } from './DiscountFaults.js';
import { DC_BANK_NOTICE, guarded, setCookie } from './DiscountFaults.js';
import {
  DC_HANDOFF_PATH,
  DC_KEY,
  DC_LANDING_COOKIES,
  DC_MI6,
  DC_MI6_MISMATCH,
  DC_PRIME_COOKIES,
  DC_SESSION_COOKIE,
  DC_TUUID,
  DC_UID,
  DC_XSRF_DECODED,
  DC_XSRF_MALFORMED,
  DC_XSRF_RAW,
  DC_XSRF_ROTATED,
  DC_XSRF_ROTATED_RAW,
  DISCOUNT_MOCK_CREDS,
} from './DiscountMockData.js';

/** The getInfo body, byte for byte. */
export const DC_GET_INFO_BODY =
  '{"Application":"WEB","Caller":"Internet","Bank":"d","Lang":"he","CustType":"private","Source":1}';

/** The `Login.Status` a refused login answers with. */
export const DC_REFUSED_STATUS = 'SYNTHETIC_REFUSED';

/** The landing's one allowed hop. */
const RETAIL_PATH = '/apollo/retail3/';

const HTML = { 'content-type': 'text/html' };
const LOGIN_PAGE = '<html><body><app-root></app-root></body></html>';
const CSRF_PAGE = `<html><head><script>var csrfToken="syn";</script></head>${LOGIN_PAGE}</html>`;
const RETAIL_PAGE = '<html><body><apollo-root></apollo-root></body></html>';

/** The pairs the login page sets. */
const PRIME_COOKIES: readonly string[] = [`XSRF-TOKEN=${DC_XSRF_RAW}`, `tuuid=${DC_TUUID}`];

/** The pairs the login page sets under a fault. */
const PRIME_FAULT_COOKIES: Partial<Record<DiscountFault, readonly string[]>> = {
  malformedXsrf: [`XSRF-TOKEN=${DC_XSRF_MALFORMED}`, `tuuid=${DC_TUUID}`],
  noTuuid: [`XSRF-TOKEN=${DC_XSRF_RAW}`],
  emptyLanguage: [...PRIME_COOKIES, 'language='],
};

/**
 * A 307 to the success hop — one that would replay the login.
 * @returns The 307.
 */
function replayingRedirect(): Response {
  return bodiless(307, { headers: { location: DC_HANDOFF_PATH } });
}

/**
 * A 302 to the success hop with a query the login never sends.
 * @returns The 302.
 */
function queriedRedirect(): Response {
  return redirectTo(`${DC_HANDOFF_PATH}?next=1`);
}

/** Where login redirects under a fault: 307 replays it, a query is extra. */
const LOGIN_FAULT_REPLY: Partial<Record<DiscountFault, () => Response>> = {
  login307: replayingRedirect,
  loginQuery: queriedRedirect,
};

/**
 * The login page — needs the four client cookies, sets XSRF-TOKEN and tuuid.
 * @param call - The recorded request.
 * @param run - The run's state.
 * @returns The page; 403 without the client cookies.
 */
function routePrime(call: IRecordedCall, run: IDiscountMockRun): Response {
  if (!hasCookies(call, DC_PRIME_COOKIES)) return errorReply(403);
  run.xsrf = DC_XSRF_DECODED;
  const setCookies = (PRIME_FAULT_COOKIES[run.fault] ?? PRIME_COOKIES).map(setCookie);
  const page = run.fault === 'csrfPage' ? CSRF_PAGE : LOGIN_PAGE;
  return reply(200, page, { headers: HTML, setCookies });
}

/**
 * getInfo — the login key, rotating XSRF-TOKEN.
 * @param call - The recorded request.
 * @param run - The run's state.
 * @returns The key as PEM (base64 DER under `derKey`); 400 for another body.
 */
function routeGetInfo(call: IRecordedCall, run: IDiscountMockRun): Response {
  if (call.body !== DC_GET_INFO_BODY) return errorReply(400);
  if (run.fault === 'actionRequired') return json({ actionRequired: { Text: DC_BANK_NOTICE } });
  run.xsrf = DC_XSRF_ROTATED;
  const key = run.fault === 'derKey' ? DC_KEY.derBase64 : DC_KEY.pem;
  const setCookies = [setCookie(`XSRF-TOKEN=${DC_XSRF_ROTATED_RAW}`)];
  return json({ GetVerificationInfo: { Key: key } }, { setCookies });
}

/**
 * A sealed field, opened with the synthetic key.
 * @param sealed - The field login sent.
 * @returns Its plaintext; '' when it does not open.
 */
function openedOf(sealed: unknown): string {
  if (typeof sealed !== 'string') return '';
  try {
    return openPkcs1(DC_KEY.privateKey, sealed);
  } catch {
    return '';
  }
}

/**
 * Whether a login body names the synthetic customer.
 * @param call - The recorded request.
 * @returns True when the Uid matches and both seals open to the credentials.
 */
function isKnownCustomer(call: IRecordedCall): boolean {
  const body = parseBody(call.body);
  const isNum = openedOf(body.ThirdIdentifier) === DISCOUNT_MOCK_CREDS.num;
  const isPassword = openedOf(body.Password) === DISCOUNT_MOCK_CREDS.password;
  return body.Uid === DC_UID && isNum && isPassword;
}

/**
 * The pairs a login sets: the session on success, plus a broken token under a fault.
 * @param run - The run's state.
 * @returns Set-Cookie lines.
 */
function loginCookies(run: IDiscountMockRun): readonly string[] {
  if (!run.isLoginOk) return [];
  const pairs = [DC_SESSION_COOKIE];
  if (run.fault === 'malformedHopXsrf') pairs.push(`XSRF-TOKEN=${DC_XSRF_MALFORMED}`);
  return pairs.map(setCookie);
}

/**
 * login — checks the seals, then redirects to the success hop.
 * @param call - The recorded request.
 * @param run - The run's state.
 * @returns A 302 to the hop (the session on success), or the fault's reply.
 */
function routeLogin(call: IRecordedCall, run: IDiscountMockRun): Response {
  run.isLoginOk = isKnownCustomer(call);
  const faultReply = LOGIN_FAULT_REPLY[run.fault];
  if (faultReply !== undefined) return faultReply();
  const setCookies = loginCookies(run);
  return redirectTo(DC_HANDOFF_PATH, setCookies);
}

/**
 * loginSuccessResponse — the outcome, bound to the Uid by MI6.
 * @param call - The recorded request.
 * @param run - The run's state.
 * @returns The refusal, or SUCCESS with MI6; 401 without the session.
 */
function routeHandoff(call: IRecordedCall, run: IDiscountMockRun): Response {
  if (!run.isLoginOk) return json({ Login: { Status: DC_REFUSED_STATUS } });
  if (!hasCookies(call, [DC_SESSION_COOKIE])) return errorReply(401);
  const mi6 = run.fault === 'mi6Mismatch' ? DC_MI6_MISMATCH : DC_MI6;
  return json({ Login: { Status: 'SUCCESS', MI6: mi6 } });
}

/**
 * /apollo/retail3 — one hop to the canonical page.
 * @returns A 301 to `/apollo/retail3/`.
 */
function routeLanding(): Response {
  return bodiless(301, { headers: { location: RETAIL_PATH } });
}

/**
 * /apollo/retail3/ — the retail page, setting `site`.
 * @returns The page.
 */
function routeRetail(): Response {
  return reply(200, RETAIL_PAGE, { headers: HTML, setCookies: [setCookie('site=retail')] });
}

/** What the landing needs: the session and the cookies the landing step sets. */
const LANDING_COOKIES: readonly string[] = [DC_SESSION_COOKIE, ...DC_LANDING_COOKIES];

/** Login routes keyed by `<METHOD> <path>`. */
export const LOGIN_ROUTES: Readonly<Partial<Record<string, Route>>> = {
  'GET /login/': routePrime,
  'POST /Lobby/gatewayAPI/verification/getInfo': guarded([], routeGetInfo),
  'POST /Lobby/gatewayAPI/login': guarded([], routeLogin),
  [`GET ${DC_HANDOFF_PATH}`]: guarded([], routeHandoff),
  'GET /apollo/retail3': guarded(LANDING_COOKIES, routeLanding),
  [`GET ${RETAIL_PATH}`]: guarded(LANDING_COOKIES, routeRetail),
};
