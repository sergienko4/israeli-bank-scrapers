/**
 * Hapoalim mock login routes — the seven auth steps, counted as `identity`.
 *
 * Rule #18: every value here is SYNTHETIC. No real PII.
 *
 *   GET  /ng-portals/auth/he/             → login shell; XSRF-TOKEN + a session cookie
 *   GET  /ng-portals/auth/serial-number   → `encryptionKey`, the seal modulus
 *   POST /authenticate/init               form; needs the `G3CmE` cookie → `result`
 *   POST /authenticate/verify             form; sealed password → `state`, `csrfcookie`
 *   POST /authenticate/logonotp/init      form → masked phone
 *   POST /authenticate/logonotp/verify    form; lower-case flow/state, decoded csrffield
 *   GET  /ServerServices/landing-page     needs the auth cookie → numeric `pageId`
 *
 * Every POST needs the form content type, both bootstrap cookies and the
 * decoded XSRF echo; a request the bank would reject answers 400 here too.
 */

import type { JsonUnknown, JsonUnknownRecord } from '../../../Scrapers/Pipeline/Types/JsonValue.js';
import { openSeal } from '../../Helpers/SealOpener.js';
import type { IRecordedCall } from '../Helpers/FetchMockKit.js';
import { errorReply, parseForm } from '../Helpers/FetchMockKit.js';
import { bodiless, hasCookies, json, reply } from '../Helpers/MockReplies.js';
import type { HapoalimFault, IMockRun, Route } from './HapoalimFaults.js';
import { authCookieOf, HP_BANK_NOTICE } from './HapoalimFaults.js';
import {
  HAPOALIM_MOCK_CREDS,
  HP_AUTH_COOKIE,
  HP_BOOT_COOKIE,
  HP_CSRF_COOKIE,
  HP_CSRF_DECODED,
  HP_G3CME,
  HP_G3CME_COOKIE,
  HP_KEY,
  HP_ORGANIZATION,
  HP_ORIGIN,
  HP_OTP,
  HP_PAGE_ID,
  HP_PHONE,
  HP_REFUSED_COOKIE,
  HP_TARGET,
  HP_XSRF_COOKIE,
  HP_XSRF_DECODED,
} from './HapoalimMockData.js';

type Form = Readonly<Record<string, string>>;
type Replies = Readonly<Partial<Record<HapoalimFault, JsonUnknownRecord>>>;

/** The step-0 path, where network faults strike. */
export const HP_BOOTSTRAP_PATH = '/ng-portals/auth/he/';

/** Where a redirect on verify would replay the credentials. */
export const HP_VERIFY_REPLAY_URL = `${HP_ORIGIN}/authenticate/verify?replay=1`;

/** A foreign landing target verify may point at. */
export const HP_FOREIGN_TARGET = 'https://www.example.com/ng-portals/rb/he';

const FORM_TYPE = 'application/x-www-form-urlencoded';
const SCOPE = '; Path=/; Secure';
const HTML = { 'content-type': 'text/html;charset=UTF-8' };
const SHELL = '<html><body><script>bnhpApp.ngContext = {};</script>SYNTHETIC</body></html>';
const BANK_ERRORS = [{ message: HP_BANK_NOTICE }];
const USER_CODE = HAPOALIM_MOCK_CREDS.userCode;

const INIT_FORM: Form = {
  identifier: USER_CODE,
  organization: HP_ORGANIZATION,
  mfp: '',
  deviceId: 'null',
};

/** verify's form, less the sealed `credentials`. */
const VERIFY_FORM: Form = {
  ...{ identifier: USER_CODE, organization: HP_ORGANIZATION, mfp: '', deviceid: 'null' },
  ...{ executionTime: '', userID: USER_CODE, authType: 'VERSAFE', G3CmE: HP_G3CME, bsd: '' },
};

const OTP_INIT_FORM: Form = {
  ...{ otpchannel: 'sms', flow: 'authenticate', state: 'logonotp' },
  ...{ mfp: '', deviceId: 'null' },
};

/** otp verify's form, less the `otp` itself. */
const OTP_VERIFY_FORM: Form = {
  ...{ state: 'logonotp', flow: 'authenticate', csrffield: HP_CSRF_DECODED },
  ...{ mfp: '', deviceId: 'null' },
};

const PENDING_OTP: JsonUnknownRecord = { state: 'LogonOTP', flow: 'Authenticate' };

const VERIFY_REPLY: Replies = {
  landpage: { state: 'landpage', target: HP_TARGET },
  locked: { state: 'Locked' },
  reissue: { state: 'reissue' },
  unknownState: { state: 'SYN-unknown' },
  foreignTarget: { ...PENDING_OTP, target: HP_FOREIGN_TARGET },
  targetNumber: { ...PENDING_OTP, target: 7 },
  noFlow: { state: 'LogonOTP' },
  verifyErrors: { ...PENDING_OTP, errors: BANK_ERRORS },
};

/** The `csrfcookie` pairs verify sets under each fault; the default sets one. */
const CSRF_COOKIES: Readonly<Partial<Record<HapoalimFault, readonly string[]>>> = {
  noCsrf: [],
  csrfBadEscape: ['csrfcookie=syn%E0%A4%A'],
  csrfLong: [`csrfcookie=${'c'.repeat(4097)}`],
};

const REDIRECT_STATUS: Readonly<Partial<Record<HapoalimFault, number>>> = {
  verify302: 302,
  verify307: 307,
};

const INIT_REPLY: Replies = { initResultString: { result: 'SYN-result' }, initResultMissing: {} };

const OTP_INIT_STATE: Readonly<Partial<Record<HapoalimFault, JsonUnknown>>> = {
  otpInitStateOther: 'other',
  otpInitStateObject: { syn: 'state' },
  otpInitStateNumber: 7,
};

const OTP_VERIFY_REPLY: Replies = {
  otpVerifyLocked: { state: 'Locked' },
  otpVerifyReissue: { state: 'reissue' },
  otpVerifyErrors: { state: 'landpage', errors: BANK_ERRORS },
};

const LANDING_REPLY: Replies = {
  pageIdBad: { pageId: 'SYN-page' },
  landingErrors: { pageId: HP_PAGE_ID, errors: BANK_ERRORS },
};

/**
 * Scope a cookie pair the bank sets.
 * @param pair - `name=value`.
 * @returns The Set-Cookie line.
 */
function scoped(pair: string): string {
  return `${pair}${SCOPE}`;
}

/**
 * Whether a POST carries what every bank POST needs.
 * @param call - The recorded request.
 * @returns True for a form POST with both bootstrap cookies and the XSRF echo.
 */
function isGuardedPost(call: IRecordedCall): boolean {
  const isForm = (call.headers.get('content-type') ?? '').startsWith(FORM_TYPE);
  const isEcho = call.headers.get('x-xsrf-token') === HP_XSRF_DECODED;
  return isForm && isEcho && hasCookies(call, [HP_XSRF_COOKIE, HP_BOOT_COOKIE]);
}

/**
 * Whether a form holds exactly the expected fields.
 * @param sent - The parsed form.
 * @param expected - Field values the bank requires.
 * @returns True when no field is missing, extra or different.
 */
function isExactForm(sent: Form, expected: Form): boolean {
  const names = Object.keys(expected);
  const isSameSize = Object.keys(sent).length === names.length;
  return isSameSize && names.every(name => sent[name] === expected[name]);
}

/**
 * Whether a call is a guarded POST with exactly the expected form.
 * @param call - The recorded request.
 * @param expected - Field values the bank requires.
 * @returns True when the bank would accept the request.
 */
function isFormCall(call: IRecordedCall, expected: Form): boolean {
  const sent = parseForm(call.body);
  return isGuardedPost(call) && isExactForm(sent, expected);
}

/**
 * Whether sealed credentials open to the synthetic password.
 * @param sealed - The posted `credentials`.
 * @returns True when the RSA blocks decrypt and the tail un-XORs to it.
 */
function opensToPassword(sealed: string): boolean {
  try {
    return openSeal(sealed, HP_KEY).source === HAPOALIM_MOCK_CREDS.password;
  } catch {
    return false;
  }
}

/**
 * bootstrap — the login shell, setting XSRF-TOKEN and a session cookie.
 * @returns The page.
 */
function routeBootstrap(): Response {
  const setCookies = [HP_XSRF_COOKIE, HP_BOOT_COOKIE].map(scoped);
  return reply(200, SHELL, { headers: HTML, setCookies });
}

/**
 * serial-number — the seal modulus.
 * @param call - The recorded request.
 * @returns The key, or 403 without the session cookie.
 */
function routeSerial(call: IRecordedCall): Response {
  if (!hasCookies(call, [HP_BOOT_COOKIE])) return errorReply(403);
  return json({ encryptionKey: HP_KEY.modulusHex });
}

/**
 * init — identifies the user; needs the client-set `G3CmE` cookie.
 * @param call - The recorded request.
 * @param run - The run's fault.
 * @returns The `result` object.
 */
function routeInit(call: IRecordedCall, run: IMockRun): Response {
  const isG3Set = hasCookies(call, [HP_G3CME_COOKIE]);
  if (!isG3Set || !isFormCall(call, INIT_FORM)) return errorReply(400);
  return json(INIT_REPLY[run.fault] ?? { result: { syn: 'init' } });
}

/**
 * Whether verify carries the cookie, the exact form and a password that opens.
 * @param call - The recorded request.
 * @returns True when the bank would accept the request.
 */
function isVerifyRequest(call: IRecordedCall): boolean {
  const { credentials = '', ...rest } = parseForm(call.body);
  const isShaped = isGuardedPost(call) && isExactForm(rest, VERIFY_FORM);
  return isShaped && hasCookies(call, [HP_G3CME_COOKIE]) && opensToPassword(credentials);
}

/**
 * The cookies verify sets under a fault.
 * @param fault - The run's fault.
 * @returns Set-Cookie lines: the CSRF cookie, plus the session on `landpage`.
 */
function verifyCookiesOf(fault: HapoalimFault): readonly string[] {
  const csrf = CSRF_COOKIES[fault] ?? [HP_CSRF_COOKIE];
  const auth = fault === 'landpage' ? [HP_AUTH_COOKIE] : [];
  return [...csrf, ...auth].map(scoped);
}

/**
 * verify — checks the sealed password; pending OTP unless a fault says otherwise.
 * @param call - The recorded request.
 * @param run - The run's fault.
 * @returns The state, or a redirect under a redirect fault.
 */
function routeVerify(call: IRecordedCall, run: IMockRun): Response {
  const status = REDIRECT_STATUS[run.fault];
  if (status !== undefined)
    return bodiless(status, { headers: { location: HP_VERIFY_REPLAY_URL } });
  if (!isVerifyRequest(call)) return errorReply(400);
  const setCookies = verifyCookiesOf(run.fault);
  return json(VERIFY_REPLY[run.fault] ?? PENDING_OTP, { setCookies });
}

/**
 * otp init — sends the SMS and reports the masked phone.
 * @param call - The recorded request.
 * @param run - The run's fault.
 * @returns The phone and the pending state.
 */
function routeOtpInit(call: IRecordedCall, run: IMockRun): Response {
  if (!isFormCall(call, OTP_INIT_FORM)) return errorReply(400);
  const state = OTP_INIT_STATE[run.fault] ?? 'logonotp';
  return json({ result: { phone: HP_PHONE }, state });
}

/**
 * otp verify — accepts the synthetic code and opens the session.
 * @param call - The recorded request.
 * @param run - The run's fault.
 * @returns `landpage` with the auth cookie, or a refusal.
 */
function routeOtpVerify(call: IRecordedCall, run: IMockRun): Response {
  const { otp = '', ...rest } = parseForm(call.body);
  if (!isGuardedPost(call) || !isExactForm(rest, OTP_VERIFY_FORM)) return errorReply(400);
  const forced = OTP_VERIFY_REPLY[run.fault];
  if (forced !== undefined) return json(forced);
  if (otp !== HP_OTP) return json({ state: 'LogonOTP' });
  const authCookie = authCookieOf(run);
  const setCookies = [scoped(authCookie)];
  return json({ state: 'landpage', target: HP_TARGET }, { setCookies });
}

/**
 * landing — the portal init that proves the session.
 * @param call - The recorded request.
 * @param run - The run's fault.
 * @returns The page model, or 401 with a refusal cookie without the run's session.
 */
function routeLanding(call: IRecordedCall, run: IMockRun): Response {
  const refusal = { setCookies: [scoped(HP_REFUSED_COOKIE)] };
  if (!hasCookies(call, [authCookieOf(run)])) return bodiless(401, refusal);
  if (new URL(call.url).search !== '?action=init') return errorReply(400);
  return json(LANDING_REPLY[run.fault] ?? { pageId: HP_PAGE_ID });
}

/** Login routes keyed `<METHOD> <path>`. */
export const AUTH_ROUTES: Readonly<Record<string, Route>> = {
  [`GET ${HP_BOOTSTRAP_PATH}`]: routeBootstrap,
  'GET /ng-portals/auth/serial-number': routeSerial,
  'POST /authenticate/init': routeInit,
  'POST /authenticate/verify': routeVerify,
  'POST /authenticate/logonotp/init': routeOtpInit,
  'POST /authenticate/logonotp/verify': routeOtpVerify,
  'GET /ServerServices/landing-page': routeLanding,
};
