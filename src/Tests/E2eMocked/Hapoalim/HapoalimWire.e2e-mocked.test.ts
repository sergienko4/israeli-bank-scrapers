/**
 * Hapoalim app wire — mocked E2E for what crosses the wire: the app headers,
 * the plain password with the Base64 device signature, the CSRF cookie
 * decoded into `csrffield`, the session cookie `step1-mobile` needs, and the
 * per-account data queries with the movements body exactly `[]`.
 *
 * Rule #18: all credentials + data are synthetic; no real PII.
 */

import type { IRecordedCall } from '../Helpers/FetchMockKit.js';
import { parseForm } from '../Helpers/FetchMockKit.js';
import { cookiesOf } from '../Helpers/MockReplies.js';
import {
  compositeOf,
  HAPOALIM_MOCK_CREDS,
  HAPOALIM_OPEN_ACCOUNTS,
  HP_APP_ID,
  HP_APP_VERSION,
  HP_DEVICE_SIGNATURE,
  HP_OTP,
} from './HapoalimMockData.js';
import { ACCOUNT_TRAIL, OTP_TRAIL, runHapoalim, trailOf, VERIFY_TRAIL } from './HapoalimRun.js';

/** A header map, as the wire carries it. */
type HeaderMap = Readonly<Record<string, string>>;

const ANY_UUID = '<uuid>';
const UUID_SHAPE = /^[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/u;

const APP_HEADERS: HeaderMap = {
  'x-bnhp-app-version': HP_APP_VERSION,
  'client-version-nbr': HP_APP_VERSION,
};
const FORM_HEADERS: HeaderMap = {
  mobile: 'ca',
  'content-type': 'application/x-www-form-urlencoded;charset=UTF-8',
};
const TXNS_HEADERS: HeaderMap = {
  ...APP_HEADERS,
  'content-type': 'application/json;charset=UTF-8',
  pageuuid: '/current-account/transactions',
  uuid: ANY_UUID,
};

/** The headers each trail entry must carry, as a subset of what it sends. */
const HEADERS_BY_STEP: Readonly<Partial<Record<string, HeaderMap>>> = {
  [VERIFY_TRAIL[0]]: APP_HEADERS,
  [VERIFY_TRAIL[1]]: FORM_HEADERS,
  [OTP_TRAIL[0]]: FORM_HEADERS,
  [OTP_TRAIL[1]]: FORM_HEADERS,
  'GET /ServerServices/step1-mobile': APP_HEADERS,
  'GET /ServerServices/general/accounts': APP_HEADERS,
  [ACCOUNT_TRAIL[0]]: APP_HEADERS,
  [ACCOUNT_TRAIL[1]]: TXNS_HEADERS,
};

/** Movements asks per account: the first page and one backfill round. */
const MOVEMENT_ASKS = 2;

/**
 * A call's headers, without its Cookie header and with any uuid masked.
 * @param call - A recorded call.
 * @returns The header map, cookie aside.
 */
function headersBesidesCookie(call: IRecordedCall): HeaderMap {
  const entries = [...call.headers].filter(([name]) => name !== 'cookie');
  const masked = entries.map(([name, value]) => {
    const isUuid = name === 'uuid' && UUID_SHAPE.test(value);
    return [name, isUuid ? ANY_UUID : value];
  });
  return Object.fromEntries(masked) as HeaderMap;
}

/**
 * The calls a run made to one step.
 * @param calls - Every recorded call.
 * @param step - A trail entry.
 * @returns The step's calls, in order.
 */
function callsTo(calls: readonly IRecordedCall[], step: string): readonly IRecordedCall[] {
  const found: IRecordedCall[] = [];
  for (const call of calls) {
    const sent = trailOf(call);
    if (sent === step) found.push(call);
  }
  return found;
}

/**
 * One query parameter of a call.
 * @param call - A recorded call.
 * @param name - Parameter name.
 * @returns Its value, or empty when absent.
 */
function queryOf(call: IRecordedCall, name: string): string {
  const { searchParams } = new URL(call.url);
  const value = searchParams.get(name);
  return value ?? '';
}

/**
 * Whether a call's headers include every expected pair.
 * @param call - A recorded call.
 * @param expected - Required header pairs.
 * @returns True when every pair matches.
 */
function hasHeaders(call: IRecordedCall, expected: HeaderMap): boolean {
  const sent = headersBesidesCookie(call);
  return Object.entries(expected).every(([name, value]) => sent[name] === value);
}

/**
 * The uuids sent to the movements step.
 * @param calls - Every recorded call.
 * @returns The masked uuids, in order.
 */
function movementUuids(calls: readonly IRecordedCall[]): readonly string[] {
  const step = ACCOUNT_TRAIL[1];
  const movements = callsTo(calls, step);
  return movements.map(call => call.headers.get('uuid') ?? '');
}

describe('Hapoalim app wire', () => {
  it('sends the app headers on every call', async () => {
    const run = await runHapoalim();
    expect(run.result.success).toBe(true);
    for (const call of run.calls) {
      const step = trailOf(call);
      const expected = HEADERS_BY_STEP[step];
      if (expected !== undefined) {
        const isMatched = hasHeaders(call, expected);
        expect(isMatched).toBe(true);
      }
    }
  });

  it('carries the app id in every query', async () => {
    const run = await runHapoalim();
    for (const call of run.calls) {
      const step = trailOf(call);
      const isAppCall =
        step.startsWith('POST /authenticate') || step.startsWith('GET /ServerServices');
      if (isAppCall) {
        const appId = queryOf(call, 'appId');
        expect(appId).toBe(HP_APP_ID);
      }
    }
  });

  it('sends a fresh uuid on each movements call', async () => {
    const run = await runHapoalim();
    const uuids = movementUuids(run.calls);
    expect(uuids).toHaveLength(HAPOALIM_OPEN_ACCOUNTS.length * MOVEMENT_ASKS);
    expect(new Set(uuids).size).toBe(uuids.length);
  });

  it('posts the plain password with the Base64 of the configured device signature', async () => {
    const run = await runHapoalim();
    const verifyCalls = callsTo(run.calls, VERIFY_TRAIL[1]);
    const verify = verifyCalls[0];
    const form = parseForm(verify.body);
    expect(form.identifier).toBe(HAPOALIM_MOCK_CREDS.userCode);
    expect(form.credentials).toBe(HAPOALIM_MOCK_CREDS.password);
    expect(form.authType).toBe('');
    expect(form.flow).toBe('authenticate');
    const expected = Buffer.from(HP_DEVICE_SIGNATURE, 'utf8').toString('base64');
    expect(form.mfp).toBe(expected);
  });

  it('sends the Base64 of a caller-supplied signature instead of the configured one', async () => {
    const supplied = JSON.stringify({
      deviceSignature: { system: { androidId: 'syn-supplied-id' } },
    });
    const run = await runHapoalim('none', { creds: { deviceSignature: supplied } });
    const verify = callsTo(run.calls, VERIFY_TRAIL[1])[0];
    const expected = Buffer.from(supplied, 'utf8').toString('base64');
    expect(parseForm(verify.body).mfp).toBe(expected);
  });

  it('decodes the CSRF cookie into csrffield on the SMS step', async () => {
    const run = await runHapoalim();
    const otpCalls = callsTo(run.calls, OTP_TRAIL[1]);
    const otpVerify = otpCalls[0];
    const form = parseForm(otpVerify.body);
    expect(form.csrffield).toBe('syn+hp/csrf');
    expect(form.otp).toBe(HP_OTP);
    expect(form.appId).toBe(HP_APP_ID);
  });

  it('sends no cookie on the first call, then carries the session', async () => {
    const run = await runHapoalim();
    const hasCookie = run.calls[0].headers.has('cookie');
    expect(hasCookie).toBe(false);
    const step1Calls = callsTo(run.calls, 'GET /ServerServices/step1-mobile');
    const step1 = step1Calls[0];
    const sent = cookiesOf(step1);
    let hasSession = false;
    for (const cookie of sent) {
      if (cookie.startsWith('SMSESSION=')) hasSession = true;
    }
    expect(hasSession).toBe(true);
  });

  it('reads each open account by its composite id, the movements body exactly []', async () => {
    const run = await runHapoalim();
    const ids = HAPOALIM_OPEN_ACCOUNTS.map(compositeOf);
    const balances = callsTo(run.calls, ACCOUNT_TRAIL[0]);
    const movements = callsTo(run.calls, ACCOUNT_TRAIL[1]);
    const balanceIds: string[] = [];
    for (const call of balances) {
      const id = queryOf(call, 'partyCurrentAccount');
      balanceIds.push(id);
    }
    const movementIds: string[] = [];
    for (const call of movements) {
      const id = queryOf(call, 'accountId');
      movementIds.push(id);
    }
    const bodies: string[] = [];
    for (const call of movements) bodies.push(call.body);
    const askedIds = ids.flatMap(id => Array.from({ length: MOVEMENT_ASKS }, () => id));
    const emptyArrays = askedIds.map(() => '[]');
    expect(balanceIds).toEqual(ids);
    expect(movementIds).toEqual(askedIds);
    expect(bodies).toEqual(emptyArrays);
  });
});
