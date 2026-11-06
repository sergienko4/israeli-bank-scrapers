/**
 * Beinleumi mocked Transmit wire — what every Transmit call must carry (the
 * SDK headers, the app, device and session ids in its query, the envelope
 * session and the flow and user headers sealed inside), and the headers the
 * bank answers with.
 *
 * Rule #18: every value here is SYNTHETIC. No real PII.
 */

import { isDeepStrictEqual } from 'node:util';

import type { IRecordedCall } from '../Helpers/FetchMockKit.js';
import { errorReply, parseBody } from '../Helpers/FetchMockKit.js';
import type { IBeinleumiMockState } from './BeinleumiFaults.js';
import { checkWire, headerChecks, hit, isQueryExactly } from './BeinleumiFaults.js';
import { BN_CRYPTO_SESSION, BN_DID, BN_UID } from './BeinleumiMockData.js';
import type { IOpenedRequest } from './BeinleumiPeer.js';
import { openRequest } from './BeinleumiPeer.js';
import {
  BN_AID,
  BN_ENTRY_URL,
  BN_ORIGIN,
  TS_AUTHORIZATION,
  TS_CLIENT_VERSION,
  WIRE_UA,
} from './BeinleumiWireSpec.js';

const JSON_TYPE = 'application/json';

/** The headers the Transmit SDK sends on every call. */
const TRANSMIT_HEADERS = {
  'content-type': JSON_TYPE,
  accept: JSON_TYPE,
  'x-ts-client-version': TS_CLIENT_VERSION,
  authorization: TS_AUTHORIZATION,
  'user-agent': WIRE_UA,
  origin: BN_ORIGIN,
  referer: BN_ENTRY_URL,
};

/** A header the bank sends that the client must look past. */
export const SERVER_TIME = { type: 'server_time', server_time: 1700000000 };

/**
 * The checks every Transmit call must pass: its headers, and a query naming
 * the app, the device id once one is known, and the session id on assertions.
 * @param state - Run state.
 * @param call - The call checked.
 * @param isAssertion - Whether the call is an assertion, which names the session.
 * @returns The checks.
 */
export function transmitChecks(
  state: IBeinleumiMockState,
  call: IRecordedCall,
  isAssertion: boolean,
): Record<string, boolean> {
  const did: Record<string, string> = state.did === '' ? {} : { did: state.did };
  const sid: Record<string, string> = isAssertion ? { sid: state.sid } : {};
  const isQuery = isQueryExactly(call, { aid: BN_AID, ...did, ...sid });
  return { ...headerChecks(call, TRANSMIT_HEADERS), query: isQuery };
}

/**
 * The checks every sealed request must pass: the session the exchange opened,
 * and the flow and user headers in that order.
 * @param state - Run state.
 * @param opened - The opened request.
 * @returns The checks.
 */
export function sealedChecks(
  state: IBeinleumiMockState,
  opened: IOpenedRequest,
): Record<string, boolean> {
  const flow = { type: 'flow_id', flow_id: state.flowId };
  const user = { type: 'uid', uid: BN_UID };
  const isSession = opened.session === BN_CRYPTO_SESSION;
  return { session: isSession, 'sealed headers': isDeepStrictEqual(opened.headers, [flow, user]) };
}

/**
 * Refuse a call the bank cannot read: not sealed under the run's key, or
 * naming no assertion the bank offered.
 * @param state - Run state.
 * @param call - The call.
 * @param name - The route name it is noted under.
 * @returns A 400, the call noted as unreadable.
 */
export function refused(state: IBeinleumiMockState, call: IRecordedCall, name: string): Response {
  hit(state, name);
  checkWire(state, call, { [`${name} readable`]: false });
  return errorReply(400);
}

/**
 * Open a sealed request under the run's envelope key.
 * @param state - Run state.
 * @param call - The call.
 * @returns The opened request, or false when it is not sealed under the key.
 */
export function openedOf(state: IBeinleumiMockState, call: IRecordedCall): IOpenedRequest | false {
  const body = parseBody(call.body);
  return openRequest(state.key, body);
}

/** The device id the bank issues on every answer. */
export const DEVICE_HEADER = { type: 'device_id', device_id: BN_DID };
