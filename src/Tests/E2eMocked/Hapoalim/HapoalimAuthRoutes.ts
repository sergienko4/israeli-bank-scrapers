/**
 * Hapoalim mock app login routes — the CA verify, the SMS challenge and the
 * device registration. The app edge only; there is no portal shell, seal or
 * landing page.
 *
 * Rule #18: every value here is SYNTHETIC. No real PII.
 *
 *   POST /authenticate/verify             plain password + device signature
 *   POST /authenticate/logonotp/init      masked phone
 *   POST /authenticate/logonotp/verify    the code; opens the session
 *   GET  /ServerServices/step1-mobile     needs the session; registers the device
 */

import type { JsonUnknown, JsonUnknownRecord } from '../../../Scrapers/Pipeline/Types/JsonValue.js';
import type { IRecordedCall } from '../Helpers/FetchMockKit.js';
import { errorReply, parseForm } from '../Helpers/FetchMockKit.js';
import { bodiless, hasCookies, json } from '../Helpers/MockReplies.js';
import type { HapoalimFault, IMockRun, Route } from './HapoalimFaults.js';
import { authCookieOf, HP_BANK_NOTICE } from './HapoalimFaults.js';
import {
  HAPOALIM_MOCK_CREDS,
  HP_APP_ID,
  HP_CSRF_COOKIE,
  HP_CSRF_DECODED,
  HP_DEVICE_ID,
  HP_ORGANIZATION,
  HP_ORIGIN,
  HP_OTP,
  HP_PHONE,
  HP_REFUSED_COOKIE,
  HP_STEP1_COOKIE,
  HP_STEPUP_OTP,
} from './HapoalimMockData.js';

type Form = Readonly<Record<string, string>>;
type Replies = Readonly<Partial<Record<HapoalimFault, JsonUnknownRecord>>>;

/** Where a redirect on verify would replay the credentials. */
export const HP_VERIFY_REPLAY_URL = `${HP_ORIGIN}/authenticate/verify?replay=1`;

/** The first login call, where transport faults strike. */
export const HP_FIRST_PATH = '/authenticate/init';

const FORM_TYPE = 'application/x-www-form-urlencoded';
const SCOPE = '; Path=/; Secure';
const USER_CODE = HAPOALIM_MOCK_CREDS.userCode;
const PASSWORD = HAPOALIM_MOCK_CREDS.password;

/** Every verify field except `credentials` and `mfp`, which are checked apart. */
const VERIFY_FORM: Form = {
  organization: HP_ORGANIZATION,
  identifier: USER_CODE,
  authType: '',
  flow: 'authenticate',
  state: 'LOGON',
  generatedDeviceID: '',
  openBanking: 'false',
  logintype: '',
  threadId: '',
  whatsapp: 'false',
  whatsappIndicator: '',
  maliciousActive: 'false',
  deviceid: '',
};

/** Every otp-init field except `mfp`. */
const OTP_INIT_FORM: Form = {
  otpchannel: 'sms',
  flow: 'authenticate',
  state: 'logonotp',
  appId: HP_APP_ID,
  target: '',
};

/** Every otp-verify field except `otp` and `mfp`. */
const OTP_VERIFY_FORM: Form = {
  appId: HP_APP_ID,
  csrffield: HP_CSRF_DECODED,
  flow: 'authenticate',
  state: 'logonotp',
};

const PENDING_OTP: JsonUnknownRecord = {
  flow: 'AUTHENTICATE',
  state: 'LogonOTP',
  result: { deviceID: HP_DEVICE_ID, reason: 'None' },
};

/** A new device: verify reports `newDevice`, so the step-up runs. */
const NEW_DEVICE_OTP: JsonUnknownRecord = {
  ...PENDING_OTP,
  result: { deviceID: HP_DEVICE_ID, reason: 'newDevice' },
};

const VERIFY_REPLY: Replies = {
  newDevice: NEW_DEVICE_OTP,
  landpage: {
    flow: 'AUTHENTICATE',
    state: 'landpage',
    result: { deviceID: HP_DEVICE_ID, reason: 'None' },
  },
  locked: { state: 'Locked' },
  reissue: { state: 'reissue' },
  unknownState: { state: 'SYN-unknown' },
  noFlow: { state: 'LogonOTP', result: { deviceID: HP_DEVICE_ID } },
  verifyErrors: { ...PENDING_OTP, error: { errCode: '9.9', errDesc: 'SYNTHETIC' } },
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

const OTP_INIT_STATE: Readonly<Partial<Record<HapoalimFault, JsonUnknown>>> = {
  otpInitStateOther: 'other',
  otpInitStateObject: { syn: 'state' },
  otpInitStateNumber: 7,
};

const OTP_VERIFY_REPLY: Replies = {
  otpVerifyLocked: { state: 'Locked' },
  otpVerifyReissue: { state: 'reissue' },
  otpVerifyErrors: { state: 'landpage', error: { errCode: '9.9', errDesc: 'SYNTHETIC' } },
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
 * Whether a call is a form POST whose named fields all match.
 * @param call - The recorded request.
 * @param expected - Field values the bank requires.
 * @returns True when the content type and every listed field match.
 */
function hasFields(call: IRecordedCall, expected: Form): boolean {
  const isForm = (call.headers.get('content-type') ?? '').startsWith(FORM_TYPE);
  if (!isForm) return false;
  const sent = parseForm(call.body);
  return Object.entries(expected).every(([name, value]) => sent[name] === value);
}

/**
 * Whether verify carries the password and a device signature.
 * @param call - The recorded request.
 * @returns True when the bank would accept the password check.
 */
function isVerifyRequest(call: IRecordedCall): boolean {
  const sent = parseForm(call.body);
  const mfp = sent.mfp as string | undefined;
  const hasSignature = mfp !== undefined && mfp !== '';
  return hasFields(call, VERIFY_FORM) && sent.credentials === PASSWORD && hasSignature;
}

/**
 * The cookies verify sets under a fault.
 * @param fault - The run's fault.
 * @returns Set-Cookie lines: the CSRF cookie, plus the session on `landpage`.
 */
function verifyCookiesOf(fault: HapoalimFault): readonly string[] {
  const csrf = CSRF_COOKIES[fault] ?? [HP_CSRF_COOKIE];
  const auth = fault === 'landpage' ? [authCookieOf({ fault })] : [];
  return [...csrf, ...auth].map(scoped);
}

/**
 * identify — the WAF warm-up; the synthetic edge answers 200 directly.
 * @returns An empty 200.
 */
function routeInit(): Response {
  return bodiless(200);
}

/**
 * verify — checks the password + signature; pending OTP unless a fault says otherwise.
 * @param call - The recorded request.
 * @param run - The run's fault.
 * @returns The state, or a redirect under a redirect fault.
 */
function routeVerify(call: IRecordedCall, run: IMockRun): Response {
  const status = REDIRECT_STATUS[run.fault];
  if (status !== undefined)
    return bodiless(status, { headers: { location: HP_VERIFY_REPLAY_URL } });
  if (!isVerifyRequest(call)) return errorReply(400);
  return json(VERIFY_REPLY[run.fault] ?? PENDING_OTP, { setCookies: verifyCookiesOf(run.fault) });
}

/**
 * otp init — sends the SMS and reports the masked phone.
 * @param call - The recorded request.
 * @param run - The run's fault.
 * @returns The phone and the pending state.
 */
function routeOtpInit(call: IRecordedCall, run: IMockRun): Response {
  const sent = parseForm(call.body);
  const mfp = sent.mfp as string | undefined;
  if (!hasFields(call, OTP_INIT_FORM) || mfp === undefined || mfp === '') return errorReply(400);
  const state = OTP_INIT_STATE[run.fault] ?? 'logonotp';
  return json({ flow: 'AUTHENTICATE', result: { phone: HP_PHONE }, state });
}

/**
 * otp verify — accepts the synthetic code and opens the session.
 * @param call - The recorded request.
 * @param run - The run's fault.
 * @returns `landpage` with the auth cookie, or a refusal.
 */
function routeOtpVerify(call: IRecordedCall, run: IMockRun): Response {
  const sent = parseForm(call.body);
  if (!hasFields(call, OTP_VERIFY_FORM)) return errorReply(400);
  const forced = OTP_VERIFY_REPLY[run.fault];
  if (forced !== undefined) return json(forced);
  if (sent.otp !== HP_OTP) return json({ state: 'LogonOTP' });
  const session = authCookieOf(run);
  const cookie = scoped(session);
  return json({ flow: 'AUTHENTICATE', state: 'landpage' }, { setCookies: [cookie] });
}

/** The cookie the step-up sets, which tells Arcot the device is validated. */
const ARCOT_COOKIE = 'ARCOT-REG=syn-hp-arcot';

/**
 * arcotid — the first call challenges a new device, the retry returns the id.
 * @param call - The recorded request.
 * @returns 302 to the step-up, or the Arcot id once validated.
 */
function routeArcot(call: IRecordedCall): Response {
  if (!hasCookies(call, [ARCOT_COOKIE])) {
    const location = `${HP_ORIGIN}/stepup/otp/init`;
    return bodiless(302, { headers: { location } });
  }
  return json({ flow: 'IMPDEVREG', state: 'FINISH', result: { arcotID: 'SYN-ARCOT' } });
}

/**
 * stepup otp init — sends the second SMS.
 * @param call - The recorded request.
 * @returns The masked phone and the pending step-up state.
 */
function routeStepupInit(call: IRecordedCall): Response {
  const sent = parseForm(call.body);
  const isStepup = sent.flow === 'IMPDEVREG' && sent.state === 'STEPUPOTP';
  if (!hasFields(call, { flow: 'IMPDEVREG', state: 'STEPUPOTP' }) || !isStepup)
    return errorReply(400);
  return json({ flow: 'IMPDEVREG', state: 'STEPUPOTP', result: { phone: HP_PHONE } });
}

/**
 * stepup otp verify — accepts the code and marks the device validated.
 * @param call - The recorded request.
 * @returns `FINISH` with the Arcot cookie.
 */
function routeStepupVerify(call: IRecordedCall): Response {
  const sent = parseForm(call.body);
  const isStepup = sent.flow === 'IMPDEVREG' && sent.state === 'STEPUPOTP';
  if (!hasFields(call, { flow: 'IMPDEVREG', state: 'STEPUPOTP', target: 'sms' }) || !isStepup)
    return errorReply(400);
  if (sent.otp !== HP_STEPUP_OTP) return json({ state: 'STEPUPOTP' });
  const cookie = scoped(ARCOT_COOKIE);
  return json({ flow: 'IMPDEVREG', state: 'FINISH' }, { setCookies: [cookie] });
}

/**
 * step1 — the device registration that proves the session.
 * @param call - The recorded request.
 * @param run - The run's fault.
 * @returns 200 with the registration cookie, an app error body, or 401
 *   without the run's session.
 */
function routeStep1(call: IRecordedCall, run: IMockRun): Response {
  const session = authCookieOf(run);
  if (!hasCookies(call, [session])) {
    const refused = scoped(HP_REFUSED_COOKIE);
    return bodiless(401, { setCookies: [refused] });
  }
  if (run.fault === 'step1Errors') {
    return json({ error: { errCode: '9.9', errDesc: HP_BANK_NOTICE } });
  }
  const registered = scoped(HP_STEP1_COOKIE);
  return bodiless(200, { setCookies: [registered] });
}

/** Login routes keyed `<METHOD> <path>`. */
export const AUTH_ROUTES: Readonly<Record<string, Route>> = {
  'GET /authenticate/init': routeInit,
  'POST /authenticate/verify': routeVerify,
  'POST /authenticate/logonotp/init': routeOtpInit,
  'POST /authenticate/logonotp/verify': routeOtpVerify,
  'GET /ServerServices/step1-mobile': routeStep1,
  'POST /arcotid/download': routeArcot,
  'POST /stepup/otp/init': routeStepupInit,
  'POST /stepup/otp/verify': routeStepupVerify,
};
