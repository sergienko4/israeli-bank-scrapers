/**
 * Beinleumi mocked Transmit routes (spec §11.2 rows 2–6): the key exchange
 * opens the envelope, the login offers the password, and one assert path
 * answers the password, the SMS trigger and the code — told apart by the
 * sealed data each names. Every call must name the app, and the device and
 * session ids the bank issued (or the device id the client already held).
 *
 * Rule #18: every value here is SYNTHETIC. No real PII.
 */

import { isDeepStrictEqual } from 'node:util';

import type { JsonUnknownRecord } from '../../../Scrapers/Pipeline/Types/JsonValue.js';
import type { IRecordedCall } from '../Helpers/FetchMockKit.js';
import { errorReply, parseBody } from '../Helpers/FetchMockKit.js';
import assertRoute from './BeinleumiAssertRoute.js';
import type { IBeinleumiMockState, Route } from './BeinleumiFaults.js';
import { checkWire, hit } from './BeinleumiFaults.js';
import { BN_CLIENT_IP, BN_CRYPTO_SESSION, BN_DID, BN_SID } from './BeinleumiMockData.js';
import { sealedReply, serverPoint, sharedKeyOf } from './BeinleumiPeer.js';
import { loginRecord } from './BeinleumiTransmitAnswers.js';
import {
  DEVICE_HEADER,
  openedOf,
  refused,
  sealedChecks,
  SERVER_TIME,
  transmitChecks,
} from './BeinleumiTransmitWire.js';
import { BN_BANK_NUM, BN_ORIGIN, WIRE_PATHS } from './BeinleumiWireSpec.js';

/** A flow id: 32 random bytes, upper-case hex. */
const FLOW_ID = /^[\dA-F]{64}$/;

/** The uncompressed secp256k1 point the client names. */
const POINT_BYTES = 65;

const LOGIN_PARAMS = { bankId: BN_BANK_NUM, client_ip: BN_CLIENT_IP };

/** The app the fingerprint names: the portal's host. */
const APP_HOST = new URL(BN_ORIGIN).host;

/** A clear header the key exchange names: the flow, or the client's point. */
interface IExchangeHeader {
  readonly type?: string;
  readonly flow_id?: string;
  readonly scheme?: number;
  readonly y?: string;
}

/** The key-exchange request, as the client sends it in clear. */
interface IExchangeRequest {
  readonly headers?: readonly IExchangeHeader[];
  readonly data?: JsonUnknownRecord;
}

/** The device fingerprint the login request collects. */
interface IFingerprint {
  readonly metadata?: { readonly timestamp?: number; readonly physical_app_id?: string };
}

/**
 * The flow and key-exchange headers, in the order the client sends them.
 * @param body - The request body.
 * @returns Both headers, each empty when absent.
 */
function exchangeHeadersOf(body: IExchangeRequest): readonly IExchangeHeader[] {
  const [flow = {}, exchange = {}] = body.headers ?? [];
  return [flow, exchange];
}

/**
 * Whether the key exchange names the flow, the client point and the greeting.
 * @param body - The request body.
 * @returns The checks.
 */
function exchangeChecks(body: IExchangeRequest): Record<string, boolean> {
  const [flow, exchange] = exchangeHeadersOf(body);
  const point = Buffer.from(exchange.y ?? '', 'base64');
  const isFlow = flow.type === 'flow_id' && FLOW_ID.test(flow.flow_id ?? '');
  const isExchange = exchange.type === 'key_exchange' && exchange.scheme === 2;
  const isGreeting = isDeepStrictEqual(body.data, { r: 'Hello Encrypted World' });
  const isTwo = body.headers?.length === 2 && point.length === POINT_BYTES;
  return {
    'flow header': isFlow,
    'exchange header': isExchange,
    greeting: isGreeting,
    'two headers': isTwo,
  };
}

/**
 * Open the envelope: derive the key from the client's point, issue the
 * device id (a known one stays), answer the bank's point.
 * @param call - The request.
 * @param state - Run state.
 * @returns The exchange answer.
 */
function keyExchange(call: IRecordedCall, state: IBeinleumiMockState): Response {
  hit(state, 'encryptionKey');
  const body = parseBody(call.body) as IExchangeRequest;
  const [flow, exchange] = exchangeHeadersOf(body);
  const key = sharedKeyOf(exchange.y ?? '');
  const checks = { ...transmitChecks(state, call, false), ...exchangeChecks(body) };
  if (!checkWire(state, call, checks) || key === false) return errorReply(400);
  Object.assign(state, { key, flowId: flow.flow_id, did: state.did || BN_DID });
  const point = { type: 'key_exchange', scheme: 2, y: serverPoint() };
  const headers = [SERVER_TIME, { ...point, crypto_session_id: BN_CRYPTO_SESSION }];
  return sealedReply(key, { r: 'Hello Encrypted World' }, [...headers, DEVICE_HEADER]);
}

/**
 * Whether the login names the bank, the client address and the fingerprint.
 * @param data - The opened data.
 * @returns True when it does.
 */
function isLoginData(data: JsonUnknownRecord): boolean {
  const collected = data.collection_result as IFingerprint;
  const metadata = collected.metadata ?? {};
  const isApp = metadata.physical_app_id === APP_HOST;
  const isFingerprint = isApp && typeof metadata.timestamp === 'number';
  const isParams = isDeepStrictEqual(data.params, LOGIN_PARAMS);
  return data.policy_request_id === 'Login' && isParams && isFingerprint;
}

/**
 * Begin the login: issue the session id, offer the password.
 * @param call - The request.
 * @param state - Run state.
 * @returns The sealed offer.
 */
function login(call: IRecordedCall, state: IBeinleumiMockState): Response {
  const opened = openedOf(state, call);
  if (opened === false) return refused(state, call, 'login');
  hit(state, 'login');
  const isData = isLoginData(opened.data);
  const checks = { ...transmitChecks(state, call, false), ...sealedChecks(state, opened) };
  if (!checkWire(state, call, { ...checks, 'login data': isData })) return errorReply(400);
  state.sid = BN_SID;
  const headers = [SERVER_TIME, { type: 'session_id', session_id: BN_SID }, DEVICE_HEADER];
  const record = loginRecord(state.fault);
  return sealedReply(state.key, record, headers);
}

const TRANSMIT_ROUTES: Readonly<Record<string, Route>> = {
  [`POST ${WIRE_PATHS.keyExchange}`]: keyExchange,
  [`POST ${WIRE_PATHS.login}`]: login,
  [`POST ${WIRE_PATHS.assert}`]: assertRoute,
};

export default TRANSMIT_ROUTES;
