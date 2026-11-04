/**
 * Mizrahi browserless wire — mocked E2E for what crosses the wire: which
 * cookie reaches which host, the anti-forgery header, the landing hops and
 * their limits, the composed data token, the raw bodies and the exact
 * header map on every call.
 *
 * Rule #18: all credentials + data are synthetic; no real PII.
 */

import type { IRecordedCall } from '../Helpers/FetchMockKit.js';
import { parseBody } from '../Helpers/FetchMockKit.js';
import type { MizrahiFault } from './MizrahiFetchMock.js';
import { cookiesOf } from './MizrahiFetchMock.js';
import {
  MIZRAHI_MOCK_CREDS,
  MZ_DATA_TOKEN,
  MZ_DATA_TOKEN_NO_SKY,
  MZ_HOP_COOKIES,
  MZ_LANDING_PATH,
  MZ_LANDING_URL,
  MZ_MTO,
  MZ_WEB,
  MZ_WEB_SESSION,
  MZ_XSRF_COOKIE,
  MZ_XSRF_DECODED,
} from './MizrahiMockData.js';
import { ACCOUNT_TRAIL, LOGIN_TRAIL, runMizrahi, trailOf } from './MizrahiRun.js';

/** A header map, as the wire carries it. */
type HeaderMap = Readonly<Record<string, string>>;

/** The truthful library User-Agent every call sends. */
const USER_AGENT = 'israeli-bank-scrapers';

/** Headers every document GET sends: no origin, no content-type. */
const DOCUMENT_HEADERS: HeaderMap = { accept: 'text/html', 'user-agent': USER_AGENT };

/**
 * Headers every JSON POST to a host sends.
 * @param origin - The host's origin.
 * @param referer - The page the call is made from.
 * @returns The header map.
 */
function postHeaders(origin: string, referer: string): HeaderMap {
  const json = 'application/json';
  return { accept: json, 'user-agent': USER_AGENT, origin, referer, 'content-type': json };
}

const LOGIN_HEADERS = postHeaders(MZ_WEB, `${MZ_WEB}/login/index.html`);
const LOGON_HEADERS = postHeaders(MZ_MTO, MZ_LANDING_URL);
const DATA_HEADERS = { ...LOGON_HEADERS, mizrahixsrftoken: MZ_DATA_TOKEN };

/** The exact header map, cookie aside, each trail entry must send. */
const HEADERS_BY_STEP: Readonly<Record<string, HeaderMap>> = {
  'GET /login/index.html': DOCUMENT_HEADERS,
  'POST /login/api/Login/LoginUser': { ...LOGIN_HEADERS, 'x-xsrf-token': MZ_XSRF_DECODED },
  'GET /Online/Default.aspx?language=he-IL': DOCUMENT_HEADERS,
  'GET /Online/Default.aspx': DOCUMENT_HEADERS,
  'POST /Online/api/SkyBL/logon': LOGON_HEADERS,
  'POST /Online/api/SkyBL/changeAccount': DATA_HEADERS,
  'POST /Online/api/SkyOSH/get428Index': DATA_HEADERS,
};

/** The login and logon bodies, byte for byte. */
const RAW_BODIES: readonly (readonly [string, string])[] = [
  [
    'POST /login/api/Login/LoginUser',
    JSON.stringify({
      Username: MIZRAHI_MOCK_CREDS.username,
      Password: MIZRAHI_MOCK_CREDS.password,
    }),
  ],
  ['POST /Online/api/SkyBL/logon', '{"appId":"skyWeb","appVer":"","lang":"he-il","isPdf":false}'],
];

/** The steps whose bodies RAW_BODIES pins. */
const RAW_STEPS: ReadonlySet<string> = new Set(RAW_BODIES.map(([step]) => step));

/** Landing-redirect faults and how many landing calls each allows first. */
const LANDING_REFUSALS: readonly (readonly [MizrahiFault, number])[] = [
  ['landingLoop', 4],
  ['foreignLocation', 1],
  ['extraQuery', 1],
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
 * The hop cookies a call sent.
 * @param call - A recorded call.
 * @returns Each hop pair its Cookie header holds.
 */
function hopCookiesOf(call: IRecordedCall): readonly string[] {
  const sent = cookiesOf(call);
  return MZ_HOP_COOKIES.filter(pair => sent.includes(pair));
}

/**
 * Whether a call went to the landing page.
 * @param call - A recorded call.
 * @returns True for every landing hop.
 */
function isLanding(call: IRecordedCall): boolean {
  return new URL(call.url).pathname === MZ_LANDING_PATH;
}

describe('Mizrahi browserless wire', () => {
  it('sends the exact header map on every call, and no content-type on a GET', async () => {
    const run = await runMizrahi();
    const sent = run.calls.map(call => [trailOf(call), headersBesidesCookie(call)]);
    const required = run.calls.map(call => [trailOf(call), HEADERS_BY_STEP[trailOf(call)]]);
    expect(run.result.success).toBe(true);
    expect(sent).toEqual(required);
  });

  it('sends the login and logon bodies byte for byte', async () => {
    const run = await runMizrahi();
    const kept = run.calls.filter(call => {
      const step = trailOf(call);
      return RAW_STEPS.has(step);
    });
    const sent = kept.map(call => [trailOf(call), call.body]);
    expect(sent).toEqual(RAW_BODIES);
  });

  it('sends the parent-domain XSRF cookie to mto but never the www-only session', async () => {
    const run = await runMizrahi();
    const mto = run.calls.filter(call => call.url.startsWith(MZ_MTO));
    const sent = mto.map(call => [
      cookiesOf(call).includes(MZ_XSRF_COOKIE),
      cookiesOf(call).includes(MZ_WEB_SESSION),
    ]);
    const required = mto.map(() => [true, false]);
    expect(mto.length).toBeGreaterThan(0);
    expect(sent).toEqual(required);
  });

  it('sends the decoded XSRF header on LoginUser and nowhere else', async () => {
    const run = await runMizrahi();
    const carriers = run.calls.filter(call => call.headers.has('x-xsrf-token')).map(trailOf);
    expect(carriers).toEqual([LOGIN_TRAIL[1]]);
  });

  it('carries each landing hop cookie into the next hop', async () => {
    const run = await runMizrahi();
    const hops = run.calls.filter(isLanding).map(hopCookiesOf);
    expect(hops).toEqual([[], MZ_HOP_COOKIES.slice(0, 1), [...MZ_HOP_COOKIES]]);
  });

  it.each(LANDING_REFUSALS)(
    'refuses a landing %s after %d landing calls and follows nothing else',
    async (fault, landingCalls) => {
      const run = await runMizrahi(fault);
      expect(run.result.success).toBe(false);
      expect(run.result.errorMessage).toBe('landing redirect refused');
      const afterLogin = run.calls.slice(LOGIN_TRAIL.length);
      expect(afterLogin).toHaveLength(landingCalls);
      const isAllLanding = afterLogin.every(isLanding);
      expect(isAllLanding).toBe(true);
    },
  );

  it('switches to each account by its logon position', async () => {
    const run = await runMizrahi();
    const switches = run.data.filter(call => trailOf(call) === ACCOUNT_TRAIL[0]);
    const bodies = switches.map(call => parseBody(call.body));
    expect(bodies).toEqual([{ selectedAccountIndex: 0 }, { selectedAccountIndex: 1 }]);
  });

  it('composes the data token with an empty session id when logon sends none', async () => {
    const run = await runMizrahi('noSkyserid');
    const tokens = new Set(run.data.map(call => call.headers.get('mizrahixsrftoken')));
    expect(run.result.success).toBe(true);
    expect([...tokens]).toEqual([MZ_DATA_TOKEN_NO_SKY]);
  });
});
