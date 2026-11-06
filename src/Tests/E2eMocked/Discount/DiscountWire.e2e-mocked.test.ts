/**
 * Discount browserless wire — mocked E2E for what crosses the wire: the
 * exact header map on every call (routing headers, the XSRF token before and
 * after it rotates, the per-account `AccountNumber`), the exact cookie set
 * on every call (the client's seeds, then each cookie the bank sets as the
 * run gets to it), the key request byte
 * for byte, the login body and its seals under a PEM or a DER key, and the
 * routing headers when the bank leaves out the session id or empties the
 * language cookie.
 *
 * Rule #18: all credentials + data are synthetic; no real PII.
 */

import { openPkcs1 } from '../../Helpers/SealOpener.js';
import type { IRecordedCall } from '../Helpers/FetchMockKit.js';
import { parseBody } from '../Helpers/FetchMockKit.js';
import { cookiesOf } from '../Helpers/MockReplies.js';
import type { DiscountFault } from './DiscountFaults.js';
import { DC_GET_INFO_BODY } from './DiscountLoginRoutes.js';
import {
  DC_KEY,
  DC_LANDING_COOKIES,
  DC_LOGIN_PAGE,
  DC_ORIGIN,
  DC_PRIME_COOKIES,
  DC_RETAIL_PAGE,
  DC_SESSION_COOKIE,
  DC_TUUID,
  DC_UID,
  DC_XSRF_DECODED,
  DC_XSRF_RAW,
  DC_XSRF_ROTATED,
  DC_XSRF_ROTATED_RAW,
  DISCOUNT_MOCK_ACCOUNTS,
  DISCOUNT_MOCK_CREDS,
} from './DiscountMockData.js';
import {
  ACCOUNTS_TRAIL,
  accountTrailOf,
  callTo,
  LOGIN_TRAIL,
  runDiscount,
  SUCCESS_HOP,
  trailOf,
} from './DiscountRun.js';

/** A header map, as the wire carries it. */
type HeaderMap = Readonly<Record<string, string>>;

const JSON_TYPE = 'application/json';

/** The routing headers every call sends, the session id and token aside. */
const ROUTING: HeaderMap = {
  'user-agent': 'BankApiInteroperabilityResearch/1.0',
  origin: DC_ORIGIN,
  language: 'HEBREW',
  site: 'retail',
  businessprocessid: '',
};

const LOGIN: HeaderMap = { accept: JSON_TYPE, referer: DC_LOGIN_PAGE, accountnumber: '' };
const LOGIN_POST: HeaderMap = { ...LOGIN, 'content-type': JSON_TYPE };
const DOCUMENT: HeaderMap = { accept: 'text/html', referer: DC_LOGIN_PAGE };
const TITAN: HeaderMap = { accept: JSON_TYPE, referer: DC_RETAIL_PAGE };

/** Routing once the login page set its cookies: the first token, then the rotated one. */
const FIRST: HeaderMap = { ...ROUTING, uuid: DC_TUUID, 'x-xsrf-token': DC_XSRF_DECODED };
const ROTATED: HeaderMap = { ...ROUTING, uuid: DC_TUUID, 'x-xsrf-token': DC_XSRF_ROTATED };

/**
 * The header map each read of one account sends.
 * @param id - The account's Titan id.
 * @returns Its two trail entries, each with its header map.
 */
function accountHeadersOf(id: string): readonly (readonly [string, HeaderMap])[] {
  const headers = { ...ROTATED, ...TITAN, accountnumber: id };
  return accountTrailOf(id).map(step => [step, headers]);
}

/** Each account read with its header map. */
const ACCOUNT_HEADERS = DISCOUNT_MOCK_ACCOUNTS.flatMap(account => accountHeadersOf(account.id));

/** The exact header map, cookie aside, each trail entry must send. */
const HEADERS_BY_STEP: Readonly<Record<string, HeaderMap>> = {
  'GET /login/': { ...ROUTING, uuid: '', ...LOGIN },
  'POST /Lobby/gatewayAPI/verification/getInfo': { ...FIRST, ...LOGIN_POST },
  'POST /Lobby/gatewayAPI/login': { ...ROTATED, ...LOGIN_POST },
  [SUCCESS_HOP]: { ...ROTATED, ...LOGIN },
  'GET /apollo/retail3': { ...ROTATED, ...DOCUMENT },
  'GET /apollo/retail3/': { ...ROTATED, ...DOCUMENT },
  [ACCOUNTS_TRAIL[0]]: { ...ROTATED, ...TITAN, accountnumber: '' },
  ...Object.fromEntries(ACCOUNT_HEADERS),
};

/** The cookie set at each stage: keyed, token rotated, session, landed, retail. */
const KEYED_JAR = [...DC_PRIME_COOKIES, `XSRF-TOKEN=${DC_XSRF_RAW}`, `tuuid=${DC_TUUID}`];
const ROTATED_JAR = [...DC_PRIME_COOKIES, `XSRF-TOKEN=${DC_XSRF_ROTATED_RAW}`, `tuuid=${DC_TUUID}`];
const SESSION_JAR = [...ROTATED_JAR, DC_SESSION_COOKIE];
const LANDED_JAR = [...SESSION_JAR, ...DC_LANDING_COOKIES];
const RETAIL_JAR = [...LANDED_JAR, 'site=retail'];

/** One trail entry with the cookie set it sends. */
type StepJar = readonly [string, readonly string[]];

/** Each account read with the cookies it sends. */
const ACCOUNT_JARS: readonly StepJar[] = DISCOUNT_MOCK_ACCOUNTS.flatMap(account =>
  accountTrailOf(account.id).map((step): StepJar => [step, RETAIL_JAR]),
);

/** The exact cookie set each trail entry must send. */
const COOKIES_BY_STEP: Readonly<Record<string, readonly string[]>> = {
  'GET /login/': DC_PRIME_COOKIES,
  'POST /Lobby/gatewayAPI/verification/getInfo': KEYED_JAR,
  'POST /Lobby/gatewayAPI/login': ROTATED_JAR,
  [SUCCESS_HOP]: SESSION_JAR,
  'GET /apollo/retail3': LANDED_JAR,
  'GET /apollo/retail3/': LANDED_JAR,
  [ACCOUNTS_TRAIL[0]]: RETAIL_JAR,
  ...Object.fromEntries(ACCOUNT_JARS),
};

/** The login body's fields, in the web app's order, seals last. */
const LOGIN_FIELDS = [
  'Application',
  'Caller',
  'Bank',
  'Lang',
  'CustType',
  'PlatformType',
  'Uid',
  'ThirdIdentifierType',
  'ThirdIdentifier',
  'Password',
];

/**
 * A call's headers, without its Cookie header.
 * @param call - A recorded call.
 * @returns The header map, cookie aside.
 */
function headersBesidesCookie(call: IRecordedCall): HeaderMap {
  const entries = [...call.headers].filter(([name]) => name !== 'cookie');
  return Object.fromEntries(entries);
}

/**
 * A cookie set in a fixed order, so the order a jar sends them in is not pinned.
 * @param pairs - `name=value` pairs.
 * @returns The pairs, sorted.
 */
function sortedPairs(pairs: readonly string[]): readonly string[] {
  return [...pairs].sort();
}

/**
 * One sealed login field, opened with the synthetic key.
 * @param sealed - The field as login sent it.
 * @returns Its plaintext.
 */
function openedSeal(sealed: unknown): string {
  const ciphertext = String(sealed);
  return openPkcs1(DC_KEY.privateKey, ciphertext);
}

/**
 * One header across every call after the login page.
 * @param calls - The run's calls.
 * @param name - The header name.
 * @returns Each later call's value.
 */
function headerAfterPrime(calls: readonly IRecordedCall[], name: string): readonly unknown[] {
  return calls.slice(1).map(call => call.headers.get(name));
}

describe('Discount browserless wire', () => {
  it('sends the exact header map on every call, rotating the XSRF token after the key', async () => {
    const run = await runDiscount();
    const sent = run.calls.map(call => [trailOf(call), headersBesidesCookie(call)]);
    const required = run.calls.map(call => [trailOf(call), HEADERS_BY_STEP[trailOf(call)]]);
    expect(run.result.success).toBe(true);
    expect(sent).toEqual(required);
  });

  it('sends the exact cookie set on every call, each bank cookie once it is set', async () => {
    const run = await runDiscount();
    const sent = run.calls.map(call => {
      const pairs = cookiesOf(call);
      return [trailOf(call), sortedPairs(pairs)];
    });
    const required = run.calls.map(call => {
      const step = trailOf(call);
      return [step, sortedPairs(COOKIES_BY_STEP[step])];
    });
    expect(run.result.success).toBe(true);
    expect(sent).toEqual(required);
  });

  it('asks for the key with the app context, byte for byte', async () => {
    const run = await runDiscount();
    const keyCall = callTo(run.calls, LOGIN_TRAIL[1]);
    expect(keyCall.body).toBe(DC_GET_INFO_BODY);
  });

  it.each<DiscountFault>(['none', 'derKey'])(
    'logs in with the formatted id and seals that open under a %s key',
    async fault => {
      const run = await runDiscount(fault);
      const loginCall = callTo(run.calls, LOGIN_TRAIL[2]);
      const body = parseBody(loginCall.body);
      const opened = [body.ThirdIdentifier, body.Password].map(openedSeal);
      const fields = Object.keys(body);
      expect(run.result.success).toBe(true);
      expect(fields).toEqual(LOGIN_FIELDS);
      expect(body.Uid).toBe(DC_UID);
      expect(opened).toEqual([DISCOUNT_MOCK_CREDS.num, DISCOUNT_MOCK_CREDS.password]);
    },
  );

  it('sends an empty session id on every call when the bank sets none', async () => {
    const run = await runDiscount('noTuuid');
    const uuids = new Set(run.calls.map(call => call.headers.get('uuid')));
    expect(run.result.success).toBe(true);
    expect([...uuids]).toEqual(['']);
  });

  it('falls back to HEBREW when the bank empties the language cookie', async () => {
    const run = await runDiscount('emptyLanguage');
    const languages = new Set(headerAfterPrime(run.calls, 'language'));
    const isCookieEmpty = run.calls.slice(1).every(call => cookiesOf(call).includes('language='));
    expect(run.result.success).toBe(true);
    expect([...languages]).toEqual(['HEBREW']);
    expect(isCookieEmpty).toBe(true);
  });
});
