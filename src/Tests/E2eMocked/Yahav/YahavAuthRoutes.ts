/**
 * Yahav mocked login routes: initialize issues the app
 * client, register verifies the device's certification request and issues a
 * certificate over its key, and the token call grants a bearer token only to
 * a request presenting a certificate this bank issued.
 *
 * Rule #18: every value here is SYNTHETIC. No real PII.
 */

import { csrSubjectDer } from '../../../Scrapers/Pipeline/Mediator/ApiDirectCall/Crypto/CsrSubject.js';
import {
  YAHAV_AUTH_PATHS,
  YAHAV_CLIENT_ID,
  YAHAV_DEVICE_NAME,
  YAHAV_NATIVE_UA,
  YAHAV_ORGANIZATION,
  YAHAV_SCOPE,
} from '../../../Scrapers/Pipeline/Registry/Config/PipelineBankConfigYahavConstants.js';
import type { IPresentedCert } from '../../../Scrapers/Pipeline/Strategy/Fetch/Mtls/MtlsAgentSource.js';
import { issueTestCert } from '../../Helpers/TestCertificate.js';
import { openTestCsr } from '../../Helpers/TestCsr.js';
import type { IRecordedCall } from '../Helpers/FetchMockKit.js';
import { errorReply, NETWORK_FAULTS } from '../Helpers/FetchMockKit.js';
import { hasCookies, json, reply } from '../Helpers/MockReplies.js';
import type { IYahavMockState, Route, RouteReply, YahavFault } from './YahavFaults.js';
import { checkWire, headerChecks, hit } from './YahavFaults.js';
import {
  YAHAV_MOCK_CREDS,
  YH_ACCESS_TOKEN,
  YH_CLIENT_ID,
  YH_CLIENT_SECRET,
  YH_INIT_COOKIE,
  YH_MAG,
  YH_REG_COOKIE,
  YH_USER,
} from './YahavMockData.js';

type Headers = Readonly<Record<string, string>>;

const LATIN1_FORM = 'application/x-www-form-urlencoded; charset=ISO-8859-1';
const UUID = /^[\da-f]{8}-[\da-f]{4}-4[\da-f]{3}-[89ab][\da-f]{3}-[\da-f]{12}$/;
const DEVICE_ID = /^[\da-f]{64}$/;

/** The key this bank signs device certificates with. */
const ISSUER_KEY = issueTestCert({ commonName: 'SYN Yahav device CA' }).keyPem;

/** SHA-256 of every certificate this bank issued: its device registry, across runs. */
export const YH_ISSUED = new Set<string>();

const APP_HEADERS: Headers = { accept: 'application/json', 'user-agent': YAHAV_NATIVE_UA };
const DEVICE_HEADERS: Headers = { 'device-status': 'activated', 'mag-identifier': YH_MAG };

const DEVICE_HEADER_FAULTS: Readonly<Partial<Record<YahavFault, Headers>>> = {
  deviceStatus: { ...DEVICE_HEADERS, 'device-status': 'pending' },
  noMag: { 'device-status': 'activated' },
  longMag: { ...DEVICE_HEADERS, 'mag-identifier': 'A'.repeat(4100) },
};

const PEM_FAULTS: Readonly<Partial<Record<YahavFault, (pem: string) => string>>> = {
  /**
   * A certificate over another key.
   * @returns A foreign certificate.
   */
  badPem: (): string => issueTestCert().certPem,
  /**
   * Two certificate blocks.
   * @param pem - The issued certificate.
   * @returns It, twice.
   */
  twoPems: (pem: string): string => `${pem}${pem}`,
};

const TOKEN_STATUS: Readonly<Partial<Record<YahavFault, number>>> = {
  token401: 401,
  token403: 403,
  token400: 400,
  token500: 500,
};

/** The status register refuses with: 401 is how the bank answers wrong credentials. */
const REGISTER_STATUS: Readonly<Partial<Record<YahavFault, number>>> = { register401: 401 };

const GRANT = { access_token: YH_ACCESS_TOKEN, token_type: 'Bearer', expires_in: 600 };

const GRANT_FAULTS: Readonly<Partial<Record<YahavFault, typeof GRANT>>> = {
  nonBearer: { ...GRANT, token_type: 'MAC' },
  noExpiry: { ...GRANT, expires_in: 0 },
};

/**
 * Base64 of a text.
 * @param text - Text.
 * @returns Its base64.
 */
function b64(text: string): string {
  return Buffer.from(text).toString('base64');
}

/**
 * A gateway cookie as the bank sets it.
 * @param pair - `name=value`.
 * @returns The Set-Cookie line.
 */
function scoped(pair: string): string {
  return `${pair}; Path=/; Secure`;
}

/**
 * Whether a form body holds exactly these fields, in this order.
 * @param body - Form body.
 * @param expected - Field name → value, in order.
 * @returns True on an exact, ordered match.
 */
function isOrderedForm(body: string, expected: Headers): boolean {
  const sent = [...new URLSearchParams(body)];
  const fields = Object.entries(expected);
  return JSON.stringify(sent) === JSON.stringify(fields);
}

/**
 * Whether a call presents a certificate this bank issued.
 * @param presented - What the transport presents.
 * @returns True for an issued certificate.
 */
export function isIssued(presented: IPresentedCert | false): boolean {
  return presented !== false && YH_ISSUED.has(presented.sha256);
}

/**
 * Whether the initialize form is the app's: its client id, then a v4 nonce.
 * @param body - Form body.
 * @returns True for the app's form.
 */
function isInitForm(body: string): boolean {
  const nonce = new URLSearchParams(body).get('nonce') ?? '';
  return isOrderedForm(body, { client_id: YAHAV_CLIENT_ID, nonce }) && UUID.test(nonce);
}

/**
 * Answer initialize: issue the app client, remembering the device id.
 * @param call - The request.
 * @param state - Run state.
 * @returns The client, or 400 when the request is off spec.
 */
function routeInitialize(call: IRecordedCall, state: IYahavMockState): Response {
  hit(state, 'initialize');
  state.deviceId = Buffer.from(call.headers.get('device-id') ?? '', 'base64').toString('ascii');
  const checks = { ...headerChecks(call, { ...APP_HEADERS, 'content-type': LATIN1_FORM }) };
  const isDevice = DEVICE_ID.test(state.deviceId);
  const isFresh = state.presented === false && call.headers.get('cookie') === null;
  const isOk = checkWire(state, call, {
    ...checks,
    form: isInitForm(call.body),
    isDevice,
    isFresh,
  });
  if (!isOk) return errorReply(400);
  return json(
    { client_id: YH_CLIENT_ID, client_secret: YH_CLIENT_SECRET },
    { setCookies: [scoped(YH_INIT_COOKIE)] },
  );
}

/**
 * The headers the app's register call sends for a device.
 * @param deviceId - The device id initialize named.
 * @returns Header name → exact value.
 */
function registerHeaders(deviceId: string): Headers {
  const user = b64(`${YH_USER}:${YAHAV_MOCK_CREDS.password}`);
  const client = b64(`${YH_CLIENT_ID}:${YH_CLIENT_SECRET}`);
  const fixed = { accept: '*/*', 'user-agent': YAHAV_NATIVE_UA, 'cert-format': 'pem' };
  const device = { 'device-id': b64(deviceId), 'device-name': b64(YAHAV_DEVICE_NAME) };
  const flags = { 'enable-multi-device-login': b64('false'), 'create-session': 'true' };
  const auth = { authorization: `Basic ${user}`, 'client-authorization': `Basic ${client}` };
  return { ...fixed, ...device, ...flags, ...auth };
}

/**
 * Whether a request names this bank, the app, the device and the user, in that order.
 * @param subject - The request's subject DER.
 * @param deviceId - The device id initialize named.
 * @returns True for the app's subject.
 */
function isDeviceSubject(subject: Buffer, deviceId: string): boolean {
  const expected = csrSubjectDer([
    { attr: 'O', value: YAHAV_ORGANIZATION },
    { attr: 'DC', value: YAHAV_DEVICE_NAME },
    { attr: 'OU', value: deviceId },
    { attr: 'CN', value: YH_USER },
  ]);
  return expected !== false && subject.equals(expected);
}

/**
 * The checks the register call must pass.
 * @param call - The request.
 * @param state - Run state.
 * @returns Check name → whether it held.
 */
function registerChecks(call: IRecordedCall, state: IYahavMockState): Record<string, boolean> {
  const csr = openTestCsr(call.body);
  const isCsr = csr !== false && isDeviceSubject(csr.subject, state.deviceId);
  const isBare = call.headers.get('content-type') === null && state.presented === false;
  const hasGateway = hasCookies(call, [YH_INIT_COOKIE]);
  const headers = registerHeaders(state.deviceId);
  return { ...headerChecks(call, headers), isCsr, isBare, hasGateway };
}

/**
 * Issue a certificate over a request's key.
 * @param body - The base64url request.
 * @returns The certificate PEM.
 */
function issueFor(body: string): string {
  const csr = openTestCsr(body);
  if (csr === false) return '';
  const subjectKeyPem = csr.publicKey.export({ type: 'spki', format: 'pem' });
  const cert = issueTestCert({ keyPem: ISSUER_KEY, subjectKeyPem, commonName: YH_USER });
  YH_ISSUED.add(cert.sha256);
  return cert.certPem;
}

/**
 * Answer register: verify the request, issue the device certificate.
 * @param call - The request.
 * @param state - Run state.
 * @returns The certificate with the device headers, the run's refusal
 *   status, or 400 when off spec.
 */
function routeRegister(call: IRecordedCall, state: IYahavMockState): Response {
  hit(state, 'register');
  const checks = registerChecks(call, state);
  if (!checkWire(state, call, checks)) return errorReply(400);
  const status = REGISTER_STATUS[state.fault];
  if (status !== undefined) return errorReply(status);
  const pem = issueFor(call.body);
  const body = PEM_FAULTS[state.fault]?.(pem) ?? pem;
  const device = DEVICE_HEADER_FAULTS[state.fault] ?? DEVICE_HEADERS;
  const headers = { 'content-type': 'text/plain', ...device };
  return reply(200, body, { headers, setCookies: [scoped(YH_REG_COOKIE)] });
}

/**
 * The checks the token call must pass.
 * @param call - The request.
 * @param state - Run state.
 * @returns Check name → whether it held.
 */
function tokenChecks(call: IRecordedCall, state: IYahavMockState): Record<string, boolean> {
  const form = { username: YH_USER, password: YAHAV_MOCK_CREDS.password };
  const client = { client_id: YH_CLIENT_ID, client_secret: YH_CLIENT_SECRET };
  const isForm = isOrderedForm(call.body, {
    ...form,
    ...client,
    scope: YAHAV_SCOPE,
    grant_type: 'password',
  });
  const headers = { ...APP_HEADERS, 'content-type': LATIN1_FORM, 'mag-identifier': YH_MAG };
  const hasGateway = hasCookies(call, [YH_INIT_COOKIE, YH_REG_COOKIE]);
  return {
    ...headerChecks(call, headers),
    isForm,
    isIssued: isIssued(state.presented),
    hasGateway,
  };
}

/**
 * Answer the token call: grant a bearer token over an issued certificate.
 * @param call - The request.
 * @param state - Run state.
 * @returns The grant; the run's fault on the first call; 400 when off spec.
 */
function routeToken(call: IRecordedCall, state: IYahavMockState): RouteReply {
  const count = hit(state, 'token');
  const isFirst = count === 1;
  const checks = tokenChecks(call, state);
  if (!checkWire(state, call, checks)) return errorReply(400);
  if (state.fault === 'recoveryToken401' && count === 2) return errorReply(401);
  const status = isFirst ? TOKEN_STATUS[state.fault] : undefined;
  if (status !== undefined) return errorReply(status);
  if (isFirst && state.fault === 'tokenTimeout') return NETWORK_FAULTS.timeout();
  return json(GRANT_FAULTS[state.fault] ?? GRANT);
}

export const AUTH_ROUTES: Readonly<Record<string, Route>> = {
  [`POST ${YAHAV_AUTH_PATHS.initialize}`]: routeInitialize,
  [`POST ${YAHAV_AUTH_PATHS.register}`]: routeRegister,
  [`POST ${YAHAV_AUTH_PATHS.token}`]: routeToken,
};
