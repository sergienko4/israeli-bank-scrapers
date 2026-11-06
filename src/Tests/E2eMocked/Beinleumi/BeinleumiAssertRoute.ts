/**
 * Beinleumi mocked assert route (spec §11.2 rows 4–4b): one Transmit path
 * answers the password, the SMS trigger and the code, told apart by the
 * method and assertion the sealed data names. Each must name the session the
 * login issued, the challenge, and the assertion the offer named.
 *
 * Rule #18: every value here is SYNTHETIC. No real PII.
 */

import { isDeepStrictEqual } from 'node:util';

import type { JsonUnknownRecord } from '../../../Scrapers/Pipeline/Types/JsonValue.js';
import type { IRecordedCall } from '../Helpers/FetchMockKit.js';
import { errorReply } from '../Helpers/FetchMockKit.js';
import type { IBeinleumiMockState } from './BeinleumiFaults.js';
import { checkWire, hit } from './BeinleumiFaults.js';
import {
  BEINLEUMI_MOCK_CREDS,
  BN_CHALLENGE,
  BN_FRESH_SID,
  BN_OTP,
  BN_OTP_ASSERTION,
  BN_OTP_TARGET,
  BN_PWD_ASSERTION,
} from './BeinleumiMockData.js';
import type { IOpenedRequest } from './BeinleumiPeer.js';
import { plainReply, sealedReply } from './BeinleumiPeer.js';
import {
  DONE_RECORD,
  passwordRecord,
  REJECTED_RECORD,
  TRIGGERED_RECORD,
} from './BeinleumiTransmitAnswers.js';
import {
  DEVICE_HEADER,
  openedOf,
  refused,
  sealedChecks,
  SERVER_TIME,
  transmitChecks,
} from './BeinleumiTransmitWire.js';

/** One assertion: the exact clear data it must send, and the bank's answer. */
interface IAssertTurn {
  readonly expected: JsonUnknownRecord;
  readonly record: JsonUnknownRecord;
}

/** An assertion the assert path answers. */
interface IAssertStep {
  readonly name: string;
  readonly turn: (inner: JsonUnknownRecord, state: IBeinleumiMockState) => IAssertTurn;
}

const COMMON = { action: 'authentication', fch: BN_CHALLENGE };
const AUTHENTICATE = 'authenticate';
const OTP_METHOD = 'otp';

const PASSWORD_FIELDS = {
  ...COMMON,
  assert: AUTHENTICATE,
  assertion_id: BN_PWD_ASSERTION,
  method: 'password',
};
const OTP_FIELDS = { ...COMMON, assertion_id: BN_OTP_ASSERTION, method: OTP_METHOD };
const TRIGGER_DATA = { target_id: BN_OTP_TARGET, channel_index: 0 };

/**
 * The password: the right one moves on to what the fault names (a fresh
 * session id when it says so); a wrong one is refused.
 * @param inner - The data the assertion seals.
 * @param state - Run state.
 * @returns The expected data and the answer.
 */
function passwordTurn(inner: JsonUnknownRecord, state: IBeinleumiMockState): IAssertTurn {
  const isRight = inner.password === BEINLEUMI_MOCK_CREDS.password;
  if (isRight && state.fault === 'otpSidRefresh') state.sid = BN_FRESH_SID;
  const record = isRight ? passwordRecord(state.fault) : REJECTED_RECORD;
  return { expected: { ...PASSWORD_FIELDS, data: { password: inner.password } }, record };
}

/**
 * The SMS trigger, on the one target the offer named.
 * @returns The expected data and the answer naming the sent code's format.
 */
function triggerTurn(): IAssertTurn {
  const expected = { ...OTP_FIELDS, assert: OTP_METHOD, data: TRIGGER_DATA };
  return { expected, record: TRIGGERED_RECORD };
}

/**
 * The SMS code: the one the bank sent completes; any other is refused.
 * @param inner - The data the assertion seals.
 * @returns The expected data and the answer.
 */
function codeTurn(inner: JsonUnknownRecord): IAssertTurn {
  const record = inner.otp === BN_OTP ? DONE_RECORD : REJECTED_RECORD;
  return { expected: { ...OTP_FIELDS, assert: AUTHENTICATE, data: { otp: inner.otp } }, record };
}

/** Each assertion, by the method and assertion its data names. */
const STEPS: Readonly<Partial<Record<string, IAssertStep>>> = {
  'password authenticate': { name: 'assertPassword', turn: passwordTurn },
  'otp otp': { name: 'otpInit', turn: triggerTurn },
  'otp authenticate': { name: 'assertOtp', turn: codeTurn },
};

/**
 * The bank's answer to an assertion: sealed, or in clear when the fault says so.
 * @param state - Run state.
 * @param record - The answer record.
 * @returns The answer, naming the session and device ids.
 */
function answer(state: IBeinleumiMockState, record: JsonUnknownRecord): Response {
  const session = { type: 'session_id', session_id: state.sid };
  const headers = [SERVER_TIME, session, DEVICE_HEADER];
  if (state.fault === 'plaintextAssert') return plainReply(record, headers);
  return sealedReply(state.key, record, headers);
}

/**
 * Answer one opened assertion.
 * @param call - The request.
 * @param state - Run state.
 * @param opened - The opened request.
 * @returns The answer, or a 400 when the request is off spec.
 */
function assertTurn(
  call: IRecordedCall,
  state: IBeinleumiMockState,
  opened: IOpenedRequest,
): Response {
  const step = STEPS[`${String(opened.data.method)} ${String(opened.data.assert)}`];
  if (step === undefined) return refused(state, call, 'assert');
  hit(state, step.name);
  const checks = { ...transmitChecks(state, call, true), ...sealedChecks(state, opened) };
  const inner = (opened.data.data ?? {}) as JsonUnknownRecord;
  const turn = step.turn(inner, state);
  const isData = isDeepStrictEqual(opened.data, turn.expected);
  if (!checkWire(state, call, { ...checks, 'assert data': isData })) return errorReply(400);
  return answer(state, turn.record);
}

/**
 * The assert path: open the request, answer the assertion it names.
 * @param call - The request.
 * @param state - Run state.
 * @returns The answer, or a 400 when the request is off spec.
 */
function assertRoute(call: IRecordedCall, state: IBeinleumiMockState): Response {
  const opened = openedOf(state, call);
  if (opened === false) return refused(state, call, 'assert');
  return assertTurn(call, state, opened);
}

export default assertRoute;
