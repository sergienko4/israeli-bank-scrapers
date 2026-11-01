/**
 * Yahav refusals and recovery — mocked E2E. The login refuses a device
 * registration or a grant off spec before anything later runs; the scrape
 * refuses a BaNCS answer whose status is not 0 or that opens no session. A
 * 401 at any BaNCS call (N33) buys one re-grant over the stored device — no
 * new registration, the gateway cookies on the token call, none on the new
 * BaNCS login — and one re-scrape from the login.
 *
 * Rule #18: all credentials + data are synthetic; no real PII.
 */

import { ScraperErrorTypes } from '../../../Scrapers/Base/ErrorTypes.js';
import type { BancsCall, YahavFault } from './YahavFaults.js';
import { YH_INIT_COOKIE, YH_REG_COOKIE } from './YahavMockData.js';
import type { IYahavRun } from './YahavRun.js';
import {
  COLD_TRAIL,
  cookiesOf,
  ENROL_TRAIL,
  foldedTrail,
  runWarm,
  runYahav,
  SCRAPE_TRAIL,
  WARM_TRAIL,
} from './YahavRun.js';

const ENROL_REFUSALS: readonly YahavFault[] = [
  'deviceStatus',
  'badPem',
  'twoPems',
  'noMag',
  'longMag',
];

const GRANT_REFUSALS: readonly YahavFault[] = ['nonBearer', 'noExpiry'];

const BANCS_CALLS: readonly BancsCall[] = [
  'login',
  'customer',
  'portfolio',
  'accounts',
  'balance',
  'txns',
];

const GATEWAY_COOKIES = [YH_INIT_COOKIE, YH_REG_COOKIE].sort();

/**
 * The scrape up to and including the BaNCS call a fault refused.
 * @param call - The refused call.
 * @returns The scrape's calls through it.
 */
function scrapedThrough(call: BancsCall): readonly string[] {
  const refusedAt = SCRAPE_TRAIL.indexOf(call);
  return SCRAPE_TRAIL.slice(0, refusedAt + 1);
}

/**
 * The cookies each call of a name sent.
 * @param run - The run.
 * @param name - The call name.
 * @returns Each such call's cookies, sorted; empty when it sent none.
 */
function cookiesOn(run: IYahavRun, name: string): readonly (readonly string[])[] {
  const calls = run.calls.filter((_, at) => run.trail[at] === name);
  return calls.map(cookiesOf);
}

describe('Yahav login refusals', () => {
  it.each(ENROL_REFUSALS)(
    'refuses a registration answer off spec (%s) before any token call',
    async fault => {
      const run = await runYahav(fault);
      expect(run.state.violations).toEqual([]);
      expect(run.result.success).toBe(false);
      expect(run.trail).toEqual(ENROL_TRAIL);
      expect(run.result.persistentOtpToken).toBeUndefined();
    },
  );

  it.each(GRANT_REFUSALS)('refuses a grant off spec (%s) before any BaNCS call', async fault => {
    const run = await runYahav(fault);
    expect(run.state.violations).toEqual([]);
    expect(run.result.success).toBe(false);
    expect(run.trail).toEqual([...ENROL_TRAIL, 'token']);
  });

  it('reports a registration refused with 401 as a wrong password', async () => {
    const run = await runYahav('register401');
    expect(run.state.violations).toEqual([]);
    expect(run.trail).toEqual(ENROL_TRAIL);
    expect(run.result).toMatchObject({
      success: false,
      errorType: ScraperErrorTypes.InvalidPassword,
      errorMessage: 'register HTTP 401',
    });
  });
});

describe('Yahav BaNCS refusals', () => {
  it('does not expose bank response text from a failed data call', async () => {
    const run = await runYahav('customer500');
    expect(run.state.violations).toEqual([]);
    expect(run.result.success).toBe(false);
    expect(run.result.errorMessage).toBe('profile HTTP 500');
  });

  it('refuses an answer whose status is not 0', async () => {
    const run = await runYahav('bankStatus');
    expect(run.state.violations).toEqual([]);
    expect(run.result.success).toBe(false);
    expect(run.trail).toEqual([...ENROL_TRAIL, 'token', 'login', 'customer']);
  });

  it('accepts a status of "0" as text', async () => {
    const run = await runYahav('statusText0');
    const trail = foldedTrail(run);
    expect(run.state.violations).toEqual([]);
    expect(run.result.success).toBe(true);
    expect(trail).toEqual(COLD_TRAIL);
  });

  it('refuses a login that opens no CSRF token', async () => {
    const run = await runYahav('noLoginCsrf');
    expect(run.state.violations).toEqual([]);
    expect(run.result.success).toBe(false);
    expect(run.trail).toEqual([...ENROL_TRAIL, 'token', 'login']);
  });
});

describe('Yahav whole-scrape recovery (N33)', () => {
  let token = '';

  beforeAll(async (): Promise<void> => {
    const run = await runYahav();
    token = run.result.persistentOtpToken ?? '';
  });

  it.each(BANCS_CALLS)(
    're-grants once and re-scrapes when %s answers 401, enrolling nothing',
    async call => {
      const run = await runWarm(token, `reject:${call}`);
      const trail = foldedTrail(run);
      const refusedScrape = scrapedThrough(call);
      const tokenCookies = cookiesOn(run, 'token');
      const loginCookies = cookiesOn(run, 'login');
      expect(run.state.violations).toEqual([]);
      expect(run.result.success).toBe(true);
      expect(trail).toEqual(['token', ...refusedScrape, ...WARM_TRAIL]);
      expect(tokenCookies).toEqual([GATEWAY_COOKIES, GATEWAY_COOKIES]);
      expect(loginCookies).toEqual([[], []]);
    },
  );

  it('gives up after one recovery when every BaNCS login answers 401', async () => {
    const run = await runWarm(token, 'rejectAlways');
    expect(run.state.violations).toEqual([]);
    expect(run.result.success).toBe(false);
    expect(run.trail).toEqual(['token', 'login', 'token', 'login']);
  });

  it('drops the rejected bearer before re-grant refusal falls back to enrollment', async () => {
    const run = await runWarm(token, 'recoveryToken401');
    const trail = foldedTrail(run);
    expect(run.calls[2]?.headers.get('authorization')).toBeNull();
    expect(run.state.violations).toEqual([]);
    expect(run.result.success).toBe(true);
    expect(trail).toEqual(['token', 'login', 'token', ...COLD_TRAIL]);
  });
});
