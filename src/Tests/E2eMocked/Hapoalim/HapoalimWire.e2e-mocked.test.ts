/**
 * Hapoalim browserless wire — mocked E2E for what crosses the wire: the exact
 * header map on every call, the raw form bodies in field order, the sealed
 * password, the client-set `G3CmE` cookie, the decoded CSRF echo, and the
 * per-account data queries with the movements body exactly `[]`.
 *
 * Rule #18: all credentials + data are synthetic; no real PII.
 */

import { openSeal } from '../../Helpers/SealOpener.js';
import type { IRecordedCall } from '../Helpers/FetchMockKit.js';
import { parseForm } from '../Helpers/FetchMockKit.js';
import { cookiesOf } from '../Helpers/MockReplies.js';
import {
  compositeOf,
  HAPOALIM_MOCK_CREDS,
  HAPOALIM_OPEN_ACCOUNTS,
  HP_G3CME,
  HP_G3CME_COOKIE,
  HP_KEY,
  HP_ORIGIN,
  HP_XSRF_DECODED,
} from './HapoalimMockData.js';
import { ACCOUNT_TRAIL, OTP_TRAIL, runHapoalim, trailOf, VERIFY_TRAIL } from './HapoalimRun.js';

/** A header map, as the wire carries it. */
type HeaderMap = Readonly<Record<string, string>>;

/** Stands in for the fresh `uuid` each movements call sends. */
/** Movements asks per account: the first page and one backfill round. */
const MOVEMENT_ASKS = ACCOUNT_TRAIL.filter(step => step === ACCOUNT_TRAIL[1]).length;

const ANY_UUID = '<uuid>';
const UUID_SHAPE = /^[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/u;

const GET_HEADERS: HeaderMap = {
  accept: 'application/json',
  'user-agent': 'israeli-bank-scrapers',
  referer: `${HP_ORIGIN}/ng-portals/auth/he/`,
};
const POST_HEADERS: HeaderMap = {
  ...GET_HEADERS,
  origin: HP_ORIGIN,
  'x-xsrf-token': HP_XSRF_DECODED,
};
const FORM_HEADERS: HeaderMap = {
  ...POST_HEADERS,
  'content-type': 'application/x-www-form-urlencoded',
};
const TXNS_HEADERS: HeaderMap = {
  ...POST_HEADERS,
  'content-type': 'application/json;charset=UTF-8',
  pageuuid: '/current-account/transactions',
  uuid: ANY_UUID,
};

/** The exact header map, cookie aside, each trail entry must send. */
const HEADERS_BY_STEP: Readonly<Record<string, HeaderMap>> = {
  [VERIFY_TRAIL[0]]: { ...GET_HEADERS, accept: 'text/html' },
  [VERIFY_TRAIL[1]]: GET_HEADERS,
  [VERIFY_TRAIL[2]]: FORM_HEADERS,
  [VERIFY_TRAIL[3]]: FORM_HEADERS,
  [OTP_TRAIL[0]]: FORM_HEADERS,
  [OTP_TRAIL[1]]: FORM_HEADERS,
  'GET /ServerServices/landing-page': GET_HEADERS,
  'GET /ServerServices/general/accounts': GET_HEADERS,
  [ACCOUNT_TRAIL[0]]: GET_HEADERS,
  [ACCOUNT_TRAIL[1]]: TXNS_HEADERS,
};

/** The form bodies with no secret, byte for byte and in field order. */
const RAW_BODIES: readonly (readonly [string, string])[] = [
  [VERIFY_TRAIL[2], 'identifier=syn-hp-user&organization=106402333&mfp=&deviceId=null'],
  [OTP_TRAIL[0], 'otpchannel=sms&flow=authenticate&state=logonotp&mfp=&deviceId=null'],
  [
    OTP_TRAIL[1],
    'otp=24680&state=logonotp&flow=authenticate&csrffield=syn%2Bhp%2Fcsrf&mfp=&deviceId=null',
  ],
];

const RAW_STEPS: ReadonlySet<string> = new Set(RAW_BODIES.map(([step]) => step));

/** verify's fields, in the order the bank's own page posts them. */
const VERIFY_FIELDS = [
  ...['identifier', 'organization', 'credentials', 'mfp', 'deviceid'],
  ...['executionTime', 'userID', 'authType', 'G3CmE', 'bsd'],
];

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
  return calls.filter(call => trailOf(call) === step);
}

/**
 * One query parameter of a call.
 * @param call - A recorded call.
 * @param name - Parameter name.
 * @returns Its value, or empty when absent.
 */
function queryOf(call: IRecordedCall, name: string): string {
  const { searchParams } = new URL(call.url);
  return searchParams.get(name) ?? '';
}

describe('Hapoalim browserless wire', () => {
  it('sends the exact header map on every call, and no content-type on a GET', async () => {
    const run = await runHapoalim();
    const sent = run.calls.map(call => [trailOf(call), headersBesidesCookie(call)]);
    const required = run.calls.map(call => [trailOf(call), HEADERS_BY_STEP[trailOf(call)]]);
    expect(run.result.success).toBe(true);
    expect(sent).toEqual(required);
  });

  it('sends a fresh uuid on each movements call', async () => {
    const run = await runHapoalim();
    const uuids = callsTo(run.calls, ACCOUNT_TRAIL[1]).map(call => call.headers.get('uuid'));
    expect(uuids).toHaveLength(HAPOALIM_OPEN_ACCOUNTS.length * MOVEMENT_ASKS);
    expect(new Set(uuids).size).toBe(uuids.length);
  });

  it('sends the form bodies byte for byte, the CSRF cookie decoded into csrffield', async () => {
    const run = await runHapoalim();
    const kept = run.calls.filter(call => {
      const step = trailOf(call);
      return RAW_STEPS.has(step);
    });
    const sent = kept.map(call => [trailOf(call), call.body]);
    expect(sent).toEqual(RAW_BODIES);
  });

  it('posts verify in field order, with the G3CmE value and a seal that opens to the password', async () => {
    const run = await runHapoalim();
    const [verify] = callsTo(run.calls, VERIFY_TRAIL[3]);
    const form = parseForm(verify.body);
    const fields = Object.keys(form);
    const opened = openSeal(form.credentials, HP_KEY);
    const encodedPassword = encodeURIComponent(HAPOALIM_MOCK_CREDS.password);
    expect(fields).toEqual(VERIFY_FIELDS);
    expect(form.G3CmE).toBe(HP_G3CME);
    expect(form.userID).toBe(HAPOALIM_MOCK_CREDS.userCode);
    expect(opened.source).toBe(HAPOALIM_MOCK_CREDS.password);
    expect(verify.body).not.toContain(encodedPassword);
  });

  it('sets the G3CmE cookie itself before init, and sends it from init on', async () => {
    const run = await runHapoalim();
    const carries = run.calls.map(call => {
      const sent = cookiesOf(call);
      return sent.includes(HP_G3CME_COOKIE);
    });
    const fromInit = run.calls.map((_call, index) => index >= 2);
    expect(carries).toEqual(fromInit);
  });

  it('sends no cookie on the first call', async () => {
    const run = await runHapoalim();
    const hasCookie = run.calls[0].headers.has('cookie');
    expect(hasCookie).toBe(false);
  });

  it('reads each open account by its composite id, the movements body exactly []', async () => {
    const run = await runHapoalim();
    const ids = HAPOALIM_OPEN_ACCOUNTS.map(compositeOf);
    const balances = callsTo(run.calls, ACCOUNT_TRAIL[0]);
    const movements = callsTo(run.calls, ACCOUNT_TRAIL[1]);
    const balanceIds = balances.map(call => queryOf(call, 'partyCurrentAccount'));
    const movementIds = movements.map(call => queryOf(call, 'accountId'));
    const bodies = movements.map(call => call.body);
    const askedIds = ids.flatMap(id => Array.from({ length: MOVEMENT_ASKS }, () => id));
    const emptyArrays = askedIds.map(() => '[]');
    expect(balanceIds).toEqual(ids);
    expect(movementIds).toEqual(askedIds);
    expect(bodies).toEqual(emptyArrays);
  });
});
