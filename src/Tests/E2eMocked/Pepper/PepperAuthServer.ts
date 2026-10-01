/**
 * Synthetic Pepper (Transmit) auth server for the offline E2E mock.
 *
 * Routes are explicit — bind, login and assert — and every other `/auth/*`
 * path answers 404. Each signed request is verified against the device key the
 * server registered at bind time (or a key the test pre-registered), so a
 * resume that signs with the wrong key, the wrong canonical string or a
 * different client instance is rejected exactly as the real server would.
 * Rule #18: every value is SYNTHETIC (no real PII, no real key material).
 */

import type { ISignedRequest } from './PepperSignatureOracle.js';
import { headerOf, isValidSignature } from './PepperSignatureOracle.js';

/** Public Transmit client identifier the app ships (not a user secret). */
const PUBLIC_TS_TOKEN =
  'TSToken 7cf2d7a7-681d-450a-ab23-06e48d2b8fd6; tid=digital_client_token_token';

const BIND_DEVICE_ID = 'syn-device-id';
const BIND_SESSION_ID = 'syn-session-id';
const BIND_CHALLENGE = 'syn-challenge';
const LOGIN_SESSION_ID = 'syn-login-session';
const LOGIN_CHALLENGE = 'syn-login-challenge';
const LOGIN_PWD_ASSERTION = 'syn-login-pwd-assert';
const BIND_PWD_ASSERTION = 'syn-pwd-assert';
const OTP_ASSERTION = 'syn-otp-assert';

type JsonObject = Record<string, unknown>;

/** Device the test registers before the run (an earlier enrollment). */
interface ISeedDevice {
  readonly deviceId: string;
  readonly publicKeyDer: Buffer;
  readonly clientInstanceId: string;
  readonly uid: string;
}

/** Server construction options. */
interface IPepperAuthServerOptions {
  readonly issuedToken: string;
  readonly password: string;
  readonly devices: readonly ISeedDevice[];
}

/** Per-route attempt tallies plus the rejection total. */
interface IAuthRouteCounts {
  bind: number;
  login: number;
  assertPassword: number;
  assertOtp: number;
  unknownAuth: number;
  rejected: number;
}

/** One open authentication session. */
interface ISession {
  readonly kind: 'bind' | 'login';
  readonly deviceId: string;
}

/** Reply the fetch mock turns into a Response-like. */
interface IAuthReply {
  readonly status: number;
  readonly payload: JsonObject;
}

/** Mutable server state shared by every route handler. */
interface IAuthServer {
  readonly options: IPepperAuthServerOptions;
  readonly devices: Map<string, ISeedDevice>;
  readonly sessions: Map<string, ISession>;
  readonly counts: IAuthRouteCounts;
  readonly rejections: string[];
}

/** Signed request plus its parsed body. */
interface IAuthRequest extends ISignedRequest {
  readonly body: JsonObject;
}

type RouteHandler = (server: IAuthServer, request: IAuthRequest) => IAuthReply;

/**
 * Build a 200 reply.
 * @param payload - Response JSON.
 * @returns Reply.
 */
function ok(payload: JsonObject): IAuthReply {
  return { status: 200, payload };
}

/**
 * Record a rejection and build a 401 reply.
 * @param server - Server state.
 * @param reason - Synthetic reason label (no request data).
 * @returns Reply.
 */
function reject(server: IAuthServer, reason: string): IAuthReply {
  server.counts.rejected += 1;
  server.rejections.push(reason);
  return { status: 401, payload: { error_code: 401, reason } };
}

/**
 * Read a nested object field, tolerating any shape.
 * @param source - Object to read.
 * @param key - Field name.
 * @returns Field value as an object, or an empty object.
 */
function objectAt(source: JsonObject, key: string): JsonObject {
  const value = source[key];
  if (typeof value !== 'object' || value === null) return {};
  return value as JsonObject;
}

/**
 * Read a nested string field.
 * @param source - Object to read.
 * @param key - Field name.
 * @returns Field value, or '' when absent / not a string.
 */
function textAt(source: JsonObject, key: string): string {
  const value = source[key];
  return typeof value === 'string' ? value : '';
}

/**
 * Find the `uid` envelope header of a Transmit request body.
 * @param body - Parsed request body.
 * @returns Declared uid, or ''.
 */
function uidOf(body: JsonObject): string {
  const headers = Array.isArray(body.headers) ? (body.headers as JsonObject[]) : [];
  const entry = headers.find((header): boolean => header.type === 'uid');
  if (entry === undefined) return '';
  return textAt(entry, 'uid');
}

/**
 * Read a query parameter of the request URL.
 * @param request - Request.
 * @param name - Parameter name.
 * @returns Value, or ''.
 */
function queryOf(request: IAuthRequest, name: string): string {
  const parsed = new URL(request.url);
  return parsed.searchParams.get(name) ?? '';
}

/**
 * Read the client instance identifier a bind or login request carries.
 * @param body - Parsed request body.
 * @returns `data.params.CellPhoneID`, or ''.
 */
function instanceIdOf(body: JsonObject): string {
  const data = objectAt(body, 'data');
  const params = objectAt(data, 'params');
  return textAt(params, 'CellPhoneID');
}

/**
 * Read the EC public key a bind request asks the server to register.
 * @param body - Parsed bind body.
 * @returns SPKI DER bytes, or false when the key is absent or not EC.
 */
function boundKeyOf(body: JsonObject): Buffer | false {
  const data = objectAt(body, 'data');
  const publicKey = objectAt(data, 'public_key');
  const keyText = textAt(publicKey, 'key');
  if (textAt(publicKey, 'type') !== 'ec' || keyText.length === 0) return false;
  return Buffer.from(keyText, 'base64');
}

/**
 * Register the bound device and open its bind session.
 * @param server - Server state.
 * @param body - Parsed bind body.
 * @param publicKeyDer - Verified device key.
 * @returns True once registered.
 */
function registerBindDevice(server: IAuthServer, body: JsonObject, publicKeyDer: Buffer): true {
  const clientInstanceId = instanceIdOf(body);
  const uid = uidOf(body);
  const device = { deviceId: BIND_DEVICE_ID, publicKeyDer, clientInstanceId, uid };
  server.devices.set(BIND_DEVICE_ID, device);
  server.sessions.set(BIND_SESSION_ID, { kind: 'bind', deviceId: BIND_DEVICE_ID });
  return true;
}

/**
 * Synthetic bind reply carrying the challenge and password assertion.
 * @returns Bind reply.
 */
function bindReply(): IAuthReply {
  const methods = [{ type: 'password', assertion_id: BIND_PWD_ASSERTION }];
  return ok({
    error_code: 0,
    data: {
      challenge: BIND_CHALLENGE,
      state: 'pending',
      control_flow: [{ type: 'auth', methods }],
    },
    headers: [
      { type: 'session_id', session_id: BIND_SESSION_ID },
      { type: 'device_id', device_id: BIND_DEVICE_ID },
    ],
  });
}

/**
 * Bind: register the device key carried in the body, open a bind session.
 * @param server - Server state.
 * @param request - Signed bind request.
 * @returns Bind reply or a rejection.
 */
function handleBind(server: IAuthServer, request: IAuthRequest): IAuthReply {
  server.counts.bind += 1;
  const publicKeyDer = boundKeyOf(request.body);
  if (publicKeyDer === false) return reject(server, 'bind-key');
  if (!isValidSignature(request, publicKeyDer)) return reject(server, 'bind-signature');
  registerBindDevice(server, request.body, publicKeyDer);
  return bindReply();
}

/**
 * Whether the request is signed by the device it names, under the phone
 * identity that device was bound with.
 * @param device - Registered device.
 * @param request - Signed request.
 * @returns True when the device proves possession of its bound key.
 */
function isDeviceRequest(device: ISeedDevice, request: IAuthRequest): boolean {
  if (!isValidSignature(request, device.publicKeyDer)) return false;
  return uidOf(request.body) === device.uid;
}

/**
 * Synthetic login reply: the server selects `authentication` + password.
 * @returns Login reply.
 */
function loginReply(): IAuthReply {
  const methods = [{ type: 'password', assertion_id: LOGIN_PWD_ASSERTION }];
  return ok({
    data: { challenge: LOGIN_CHALLENGE, control_flow: [{ type: 'authentication', methods }] },
    headers: [{ type: 'session_id', session_id: LOGIN_SESSION_ID }],
  });
}

/**
 * Login: start an authentication on an already-bound device. The client
 * instance must be the one the device was bound with.
 * @param server - Server state.
 * @param request - Signed login request.
 * @returns Login reply or a rejection.
 */
function handleLogin(server: IAuthServer, request: IAuthRequest): IAuthReply {
  server.counts.login += 1;
  const deviceId = queryOf(request, 'did');
  const device = server.devices.get(deviceId);
  if (device === undefined) return reject(server, 'login-unknown-device');
  if (!isDeviceRequest(device, request)) return reject(server, 'login-signature');
  const instanceId = instanceIdOf(request.body);
  if (instanceId !== device.clientInstanceId) return reject(server, 'login-instance');
  server.sessions.set(LOGIN_SESSION_ID, { kind: 'login', deviceId });
  return loginReply();
}

/** Expected password-assertion fields per session kind. */
const PASSWORD_ASSERTION: Readonly<Record<ISession['kind'], JsonObject>> = {
  bind: { assertion_id: BIND_PWD_ASSERTION, fch: BIND_CHALLENGE, action: 'authentication' },
  login: { assertion_id: LOGIN_PWD_ASSERTION, fch: LOGIN_CHALLENGE, action: 'authentication' },
};

/**
 * Whether a password assertion names the session's challenge and password.
 * @param server - Server state.
 * @param session - Open session.
 * @param data - Assertion `data` object.
 * @returns True when every expected field matches.
 */
function isPasswordAssertion(server: IAuthServer, session: ISession, data: JsonObject): boolean {
  const expected = PASSWORD_ASSERTION[session.kind];
  const isNamed = Object.entries(expected).every(([key, value]): boolean => data[key] === value);
  const secret = objectAt(data, 'data');
  return isNamed && textAt(secret, 'password') === server.options.password;
}

/**
 * Bind-flow password reply: the server now asks for the SMS OTP.
 * @returns Pending reply with the OTP channel assertion.
 */
function otpChallengeReply(): IAuthReply {
  const channels = [{ type: 'sms', assertion_id: OTP_ASSERTION }];
  return ok({
    data: { state: 'pending', control_flow: [{ type: 'auth', methods: [{ channels }] }] },
  });
}

/**
 * Successful completion carrying the configured access token.
 * @param server - Server state.
 * @returns Success reply.
 */
function tokenReply(server: IAuthServer): IAuthReply {
  return ok({ data: { state: 'success', token: server.options.issuedToken } });
}

/**
 * Password assertion on an open session.
 * @param server - Server state.
 * @param session - Open session.
 * @param data - Assertion `data` object.
 * @returns Next-step reply or a rejection.
 */
function assertPassword(server: IAuthServer, session: ISession, data: JsonObject): IAuthReply {
  server.counts.assertPassword += 1;
  if (!isPasswordAssertion(server, session, data)) return reject(server, 'assert-password');
  if (session.kind === 'login') return tokenReply(server);
  return otpChallengeReply();
}

/**
 * OTP assertion — only a bind (enrollment) session may reach it.
 * @param server - Server state.
 * @param session - Open session.
 * @param data - Assertion `data` object.
 * @returns Success reply or a rejection.
 */
function assertOtp(server: IAuthServer, session: ISession, data: JsonObject): IAuthReply {
  server.counts.assertOtp += 1;
  const isBindOtp = session.kind === 'bind' && data.assertion_id === OTP_ASSERTION;
  if (!isBindOtp) return reject(server, 'assert-otp');
  return tokenReply(server);
}

type AssertionHandler = (server: IAuthServer, session: ISession, data: JsonObject) => IAuthReply;

/** Assertion handlers keyed by `data.method`. */
const ASSERTION_METHODS: Readonly<Record<string, AssertionHandler>> = {
  password: assertPassword,
  otp: assertOtp,
};

/**
 * Dispatch a verified assertion on its method.
 * @param server - Server state.
 * @param session - Open session.
 * @param body - Parsed assert body.
 * @returns Assertion reply or a rejection.
 */
function dispatchAssertion(server: IAuthServer, session: ISession, body: JsonObject): IAuthReply {
  const data = objectAt(body, 'data');
  const method = textAt(data, 'method');
  const handler = ASSERTION_METHODS[method] as AssertionHandler | undefined;
  if (handler === undefined) return reject(server, 'assert-method');
  return handler(server, session, data);
}

/**
 * Assert: verify the session/device pair and signature, then dispatch.
 * @param server - Server state.
 * @param request - Signed assert request.
 * @returns Assertion reply or a rejection.
 */
function handleAssert(server: IAuthServer, request: IAuthRequest): IAuthReply {
  const deviceId = queryOf(request, 'did');
  const sessionId = queryOf(request, 'sid');
  const session = server.sessions.get(sessionId);
  const device = server.devices.get(deviceId);
  if (session?.deviceId !== deviceId || device === undefined) return reject(server, 'assert-sid');
  if (!isDeviceRequest(device, request)) return reject(server, 'assert-signature');
  return dispatchAssertion(server, session, request.body);
}

/** Explicit route table — every other `/auth/*` path is unknown. */
const AUTH_ROUTES: Readonly<Record<string, RouteHandler>> = {
  '/api/v2/auth/bind': handleBind,
  '/api/v2/auth/login': handleLogin,
  '/api/v2/auth/assert': handleAssert,
};

/**
 * Parse a request body as a JSON object.
 * @param bodyText - Raw body.
 * @returns Parsed object, or an empty object.
 */
function parseBody(bodyText: string): JsonObject {
  try {
    const parsed: unknown = JSON.parse(bodyText);
    return typeof parsed === 'object' && parsed !== null ? (parsed as JsonObject) : {};
  } catch {
    return {};
  }
}

/**
 * Reply for a path outside the route table.
 * @param server - Server state.
 * @returns 404 reply.
 */
function unknownRoute(server: IAuthServer): IAuthReply {
  server.counts.unknownAuth += 1;
  return { status: 404, payload: { message: 'unknown auth route' } };
}

/**
 * Handle one auth request.
 * @param server - Server state.
 * @param request - Request as the transport sent it.
 * @returns Reply for the fetch mock.
 */
function handleAuthRequest(server: IAuthServer, request: ISignedRequest): IAuthReply {
  const { pathname } = new URL(request.url);
  const route = AUTH_ROUTES[pathname] as RouteHandler | undefined;
  if (route === undefined) return unknownRoute(server);
  const tsToken = headerOf(request.headers, 'authorization');
  if (tsToken !== PUBLIC_TS_TOKEN) return reject(server, 'ts-token');
  const body = parseBody(request.bodyText);
  return route(server, { ...request, body });
}

/**
 * Create a synthetic auth server.
 * @param options - Issued token, password and pre-registered devices.
 * @returns Fresh server state.
 */
function createPepperAuthServer(options: IPepperAuthServerOptions): IAuthServer {
  const seeded = options.devices.map((device): [string, ISeedDevice] => [device.deviceId, device]);
  const counts = {
    bind: 0,
    login: 0,
    assertPassword: 0,
    assertOtp: 0,
    unknownAuth: 0,
    rejected: 0,
  };
  const devices = new Map(seeded);
  return { options, devices, sessions: new Map(), counts, rejections: [] };
}

export type { IAuthReply, IAuthRouteCounts, IAuthServer, IPepperAuthServerOptions, ISeedDevice };
export { createPepperAuthServer, handleAuthRequest };
