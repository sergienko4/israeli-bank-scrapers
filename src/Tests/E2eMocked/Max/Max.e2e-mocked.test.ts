/**
 * Max browserless login — mocked E2E for what the shared API-DIRECT flow spec
 * cannot see: the session cookie and id headers, the browser never launching,
 * each login refusal, a lost session, and every way step 0 can fail. The
 * happy cold run lives in ApiDirectFlow.
 *
 * Rule #18: all credentials + data are synthetic; no real PII.
 */

import { ok } from 'node:assert/strict';

import { CompanyTypes } from '../../../Definitions.js';
import { ScraperErrorTypes } from '../../../Scrapers/Base/ErrorTypes.js';
import type {
  IScraperScrapingResult,
  ScraperCredentials,
} from '../../../Scrapers/Base/Interface.js';
import { MAX_HEADLESS } from '../../../Scrapers/Pipeline/Registry/Config/PipelineBankConfigMax.js';
import createScraper from '../../../Scrapers/Registry/Factory.js';
import { getLaunchCount } from '../../Mocks/CamoufoxJsMock.js';
import type { IRecordedCall } from '../Helpers/FetchMockKit.js';
import type { MaxFault } from './MaxFetchMock.js';
import {
  classifyMax,
  installMaxFetchMock,
  MAX_AUTH_COOKIE,
  MAX_MOCK_CARDS,
  MAX_MOCK_CREDS,
  MAX_MOCK_START_DATE,
  MAX_ROW_AMOUNTS,
} from './MaxFetchMock.js';

/** What one mocked run produced. */
interface IMaxRun {
  readonly result: IScraperScrapingResult;
  readonly calls: readonly IRecordedCall[];
  /** Last path segment of each login call, in order. */
  readonly steps: readonly string[];
  /** Every call that was not a login call. */
  readonly data: readonly IRecordedCall[];
  readonly launches: number;
}

const COLD_STEPS = ['clientcontext', 'login'];

/** A canonical lowercase UUID, as node's randomUUID gives. */
const UUID_PATTERN = /^[\da-f]{8}-[\da-f]{4}-4[\da-f]{3}-[89ab][\da-f]{3}-[\da-f]{12}$/;

/** A well-formed session id a caller might slip into the credentials. */
const CALLER_SID = '00000000-0000-4000-8000-000000000000';

/** Headers Max's web app adds to every API call, even while they are empty. */
const APP_HEADERS = ['urf', 'cav'];

/**
 * Resolve a configured Max login endpoint for a mock request.
 * @param tag - Login route to exercise.
 * @returns The URL configured for that route.
 */
function maxAuthUrl(tag: 'auth.prime' | 'auth.login'): string {
  const url = MAX_HEADLESS.paths[tag];
  ok(url, `Missing Max auth URL: ${tag}`);
  return url;
}

/**
 * Whether a call was a login call.
 * @param call - A recorded call.
 * @returns True for clientcontext and login.
 */
function isLoginCall(call: IRecordedCall): boolean {
  return classifyMax(call) === 'identity';
}

/**
 * The login step a call named.
 * @param call - A login call.
 * @returns The last path segment of its URL.
 */
function stepOf(call: IRecordedCall): string {
  return call.url.split('/').pop() ?? '';
}

/**
 * Split a call log into its login steps and data calls.
 * @param calls - The run's call log.
 * @returns The login step names and the data calls.
 */
function splitCalls(calls: readonly IRecordedCall[]): Pick<IMaxRun, 'steps' | 'data'> {
  const logins = calls.filter(isLoginCall);
  const data = calls.filter(call => !isLoginCall(call));
  return { steps: logins.map(stepOf), data };
}

/**
 * Scrape Max against the synthetic site.
 * @param creds - Credentials to scrape with.
 * @param fault - Fault the site answers with.
 * @returns The result, the call log and how many browsers were launched.
 */
async function runMax(creds: ScraperCredentials, fault: MaxFault = 'none'): Promise<IMaxRun> {
  const launchesBefore = getLaunchCount();
  const handle = installMaxFetchMock(fault);
  try {
    const options = { companyId: CompanyTypes.Max, startDate: MAX_MOCK_START_DATE };
    const scraper = createScraper(options);
    const result = await scraper.scrape(creds);
    const launches = getLaunchCount() - launchesBefore;
    const calls = handle.calls();
    return { result, calls, ...splitCalls(calls), launches };
  } finally {
    handle.dispose();
  }
}

/**
 * Whether a call carries the auth cookie login set.
 * @param call - A recorded call.
 * @returns True when the Cookie header holds it.
 */
function hasAuthCookie(call: IRecordedCall): boolean {
  const cookies = (call.headers.get('cookie') ?? '').split('; ');
  return cookies.includes(MAX_AUTH_COOKIE);
}

/**
 * A header's value on every call.
 * @param calls - The run's call log.
 * @param name - Header name.
 * @returns One value per call; empty where the call lacks it.
 */
function headerOf(calls: readonly IRecordedCall[], name: string): readonly string[] {
  return calls.map(call => call.headers.get(name) ?? '');
}

/** A login Max refuses: the input, the failure it must surface. */
interface IRefusal {
  readonly name: string;
  readonly creds: ScraperCredentials;
  readonly fault: MaxFault;
  readonly errorType: ScraperErrorTypes;
  readonly message: string;
}

/** Refused logins and the failure each must surface, before any data call. */
const REFUSALS: readonly IRefusal[] = [
  {
    name: 'a wrong password',
    creds: { ...MAX_MOCK_CREDS, password: 'synthetic-wrong-pass' },
    fault: 'none',
    errorType: ScraperErrorTypes.InvalidPassword,
    message: 'login outcome 4',
  },
  {
    name: 'a password Max wants changed',
    creds: { ...MAX_MOCK_CREDS },
    fault: 'changePassword',
    errorType: ScraperErrorTypes.ChangePassword,
    message: 'login outcome 1',
  },
  {
    name: 'a login status Max never documented, without echoing it',
    creds: { ...MAX_MOCK_CREDS },
    fault: 'unknownStatus',
    errorType: ScraperErrorTypes.Generic,
    message: 'login outcome unmapped',
  },
];

/** Step-0 faults and the failure each must surface, with no response text. */
const STEP_ZERO_FAULTS: readonly (readonly [MaxFault, ScraperErrorTypes, string])[] = [
  ['http500', ScraperErrorTypes.Generic, 'prime HTTP 500'],
  ['reject', ScraperErrorTypes.Generic, 'prime GENERIC'],
  ['nonJson', ScraperErrorTypes.Generic, 'prime GENERIC'],
  ['timeout', ScraperErrorTypes.Timeout, 'prime TIMEOUT'],
];

describe('Max browserless login', () => {
  it('refuses POST when priming the session', async () => {
    const handle = installMaxFetchMock();
    try {
      const primeUrl = maxAuthUrl('auth.prime');
      const response = await fetch(primeUrl, { method: 'POST' });
      expect(response.status).toBe(405);
      const hasSetCookie = response.headers.has('set-cookie');
      expect(hasSetCookie).toBe(false);
    } finally {
      handle.dispose();
    }
  });

  it('refuses GET login with the priming cookie', async () => {
    const handle = installMaxFetchMock();
    try {
      const primeUrl = maxAuthUrl('auth.prime');
      const prime = await fetch(primeUrl);
      const cookie = prime.headers.get('set-cookie')?.split(';')[0];
      ok(cookie, 'Max mock did not provide a priming cookie');
      const loginUrl = maxAuthUrl('auth.login');
      const response = await fetch(loginUrl, {
        method: 'GET',
        headers: { cookie },
      });
      expect(response.status).toBe(405);
      const hasSetCookie = response.headers.has('set-cookie');
      expect(hasSetCookie).toBe(false);
    } finally {
      handle.dispose();
    }
  });

  it('signs in cold, rides the session cookie on every data call and launches no browser', async () => {
    const run = await runMax({ ...MAX_MOCK_CREDS });
    expect(run.result.success).toBe(true);
    expect(run.launches).toBe(0);
    expect(run.steps).toEqual(COLD_STEPS);
    expect(run.data.length).toBeGreaterThan(0);
    const sent = run.data.map(call => [call.method, hasAuthCookie(call)]);
    const required = run.data.map(() => ['GET', true]);
    expect(sent).toEqual(required);
  });

  it('sends one session id on every call and a fresh correlation id on each', async () => {
    const run = await runMax({ ...MAX_MOCK_CREDS });
    const sids = new Set(headerOf(run.calls, 'sid'));
    const cids = new Set(headerOf(run.calls, 'cid'));
    const [sid] = [...sids];
    expect(sids.size).toBe(1);
    expect(sid).toMatch(UUID_PATTERN);
    expect(cids.size).toBe(run.calls.length);
  });

  it("sends the web app's own headers on every call", async () => {
    const run = await runMax({ ...MAX_MOCK_CREDS });
    const sent = run.calls.map(call => APP_HEADERS.map(name => call.headers.has(name)));
    const required = run.calls.map(() => APP_HEADERS.map(() => true));
    expect(run.calls.length).toBeGreaterThan(0);
    expect(sent).toEqual(required);
  });

  it('never takes the session id from the credentials', async () => {
    const withSid = { ...MAX_MOCK_CREDS, sid: CALLER_SID };
    const run = await runMax(withSid);
    const sids = [...new Set(headerOf(run.calls, 'sid'))];
    expect(sids).toHaveLength(1);
    expect(sids[0]).toMatch(UUID_PATTERN);
    expect(sids[0]).not.toBe(CALLER_SID);
  });

  it('reports each card with its own rows and cycle debit', async () => {
    const run = await runMax({ ...MAX_MOCK_CREDS });
    const accounts = run.result.accounts ?? [];
    const summary = accounts.map(account => [
      account.accountNumber,
      account.balance,
      account.txns.map(txn => txn.chargedAmount),
    ]);
    const charged = MAX_ROW_AMOUNTS.map(amount => -amount);
    const expected = MAX_MOCK_CARDS.map(card => [card.last4, card.cycleDebit, charged]);
    expect(summary).toEqual(expected);
  });

  it.each(REFUSALS)('fails $name before any data call', async (refusal: IRefusal) => {
    const run = await runMax(refusal.creds, refusal.fault);
    expect(run.result.success).toBe(false);
    expect(run.result.errorType).toBe(refusal.errorType);
    expect(run.result.errorMessage).toBe(refusal.message);
    expect(run.steps).toEqual(COLD_STEPS);
    expect(run.data).toHaveLength(0);
  });

  it('fails a login bot page without echoing its HTML or retrying', async () => {
    const run = await runMax({ ...MAX_MOCK_CREDS }, 'loginHtml');
    expect(run.result.success).toBe(false);
    expect(run.result.errorType).toBe(ScraperErrorTypes.Generic);
    expect(run.result.errorMessage).toBe('login GENERIC');
    expect(run.result.errorMessage).not.toContain('synthetic Max challenge');
    expect(run.steps).toEqual(COLD_STEPS);
    expect(run.calls).toHaveLength(2);
    expect(run.data).toHaveLength(0);
  });

  it('fails a lost session at the card list without logging in again', async () => {
    const run = await runMax({ ...MAX_MOCK_CREDS }, 'expireSession');
    expect(run.result.success).toBe(false);
    expect(run.result.errorType).toBe(ScraperErrorTypes.Generic);
    expect(run.steps).toEqual(COLD_STEPS);
    expect(run.data).toHaveLength(1);
  });

  it.each(STEP_ZERO_FAULTS)(
    'fails a step-0 %s after one call, with no retry and no response text',
    async (fault, errorType, message) => {
      const run = await runMax({ ...MAX_MOCK_CREDS }, fault);
      expect(run.result.success).toBe(false);
      expect(run.result.errorType).toBe(errorType);
      expect(run.result.errorMessage).toBe(message);
      expect(run.calls).toHaveLength(1);
    },
  );

  it('rejects an empty password before sending any request', async () => {
    const run = await runMax({ ...MAX_MOCK_CREDS, password: '' });
    expect(run.result.success).toBe(false);
    expect(run.result.errorType).toBe(ScraperErrorTypes.Generic);
    expect(run.result.errorMessage).toBe('Missing or malformed credentials: password');
    expect(run.calls).toHaveLength(0);
  });
});
