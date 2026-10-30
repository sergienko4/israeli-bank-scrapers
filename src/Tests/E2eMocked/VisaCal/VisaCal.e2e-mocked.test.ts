/**
 * Visa Cal browserless login — mocked-gateway E2E for what the shared
 * API-DIRECT flow spec cannot see: the request headers, the browser never
 * launching, the password staying off the warm path, and every way step 0
 * can fail. The happy cold and warm runs live in ApiDirectFlow.
 *
 * Rule #18: all credentials + data are synthetic; no real PII.
 */

import { CompanyTypes } from '../../../Definitions.js';
import { ScraperErrorTypes } from '../../../Scrapers/Base/ErrorTypes.js';
import type {
  IScraperScrapingResult,
  ScraperCredentials,
} from '../../../Scrapers/Base/Interface.js';
import { CAL_WEB_SITE_ID } from '../../../Scrapers/Pipeline/Banks/VisaCal/scrape/VisaCalShapeHelpers.js';
import createScraper from '../../../Scrapers/Registry/Factory.js';
import { getLaunchCount } from '../../Mocks/CamoufoxJsMock.js';
import type { IRecordedCall, LoginFault } from './VisaCalFetchMock.js';
import {
  installVisaCalFetchMock,
  rotatedHash,
  SYN_LOGIN_HASH,
  SYN_STORED_HASH,
  VISACAL_DATA_AUTH,
  VISACAL_MOCK_CARDS,
  VISACAL_MOCK_CREDS,
  VISACAL_MOCK_START_DATE,
} from './VisaCalFetchMock.js';

/** What one mocked run produced. */
interface ICalRun {
  readonly result: IScraperScrapingResult;
  readonly calls: readonly IRecordedCall[];
  /** Last path segment of each login-gateway call, in order. */
  readonly steps: readonly string[];
  /** Every call that did not go to the login gateway. */
  readonly data: readonly IRecordedCall[];
  readonly launches: number;
}

const LOGIN_HOST = 'https://api-cc.cal-online.co.il/';

/**
 * Whether a call went to the login gateway.
 * @param call - A recorded call.
 * @returns True for the login host.
 */
function isLoginCall(call: IRecordedCall): boolean {
  return call.url.startsWith(LOGIN_HOST);
}

/**
 * The login step a call named.
 * @param call - A login-gateway call.
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
function splitCalls(calls: readonly IRecordedCall[]): Pick<ICalRun, 'steps' | 'data'> {
  const logins = calls.filter(isLoginCall);
  const data = calls.filter(call => !isLoginCall(call));
  return { steps: logins.map(stepOf), data };
}

/**
 * Scrape Visa Cal against the synthetic gateways.
 * @param creds - Credentials to scrape with.
 * @param fault - Fault the password login answers with.
 * @returns The result, the call log and how many browsers were launched.
 */
async function runCal(creds: ScraperCredentials, fault: LoginFault = 'none'): Promise<ICalRun> {
  const launchesBefore = getLaunchCount();
  const handle = installVisaCalFetchMock(fault);
  try {
    const options = { companyId: CompanyTypes.VisaCal, startDate: VISACAL_MOCK_START_DATE };
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
 * Whether any request body carries a value.
 * @param calls - The run's call log.
 * @param value - Value to look for.
 * @returns True when some body contains it.
 */
function isSent(calls: readonly IRecordedCall[], value: string): boolean {
  return calls.some(call => call.body.includes(value));
}

/** What the caller stores after a cold run: bioLogin's rotation of the login hash. */
const COLD_RUN_HASH = rotatedHash(SYN_LOGIN_HASH);

/** A stored token with a line break — refused before it reaches the wire. */
const MALFORMED_TOKEN = 'syn-malformed\r\ntoken';

/** Step-0 faults and the failure each must surface, with no response text. */
const STEP_ZERO_FAULTS: readonly (readonly [LoginFault, ScraperErrorTypes, string])[] = [
  ['http500', ScraperErrorTypes.Generic, 'login HTTP 500'],
  ['reject', ScraperErrorTypes.Generic, 'login GENERIC'],
  ['nonJson', ScraperErrorTypes.Generic, 'login GENERIC'],
  ['timeout', ScraperErrorTypes.Timeout, 'login TIMEOUT'],
];

describe('Visa Cal browserless login', () => {
  it('signs in cold, sends the CAL headers on every data call and launches no browser', async () => {
    const run = await runCal({ ...VISACAL_MOCK_CREDS });
    expect(run.result.success).toBe(true);
    expect(run.launches).toBe(0);
    expect(run.steps).toEqual(['regularLogin', 'bioLogin']);
    expect(run.data.length).toBeGreaterThan(0);
    const sent = run.data.map(call => [
      call.method,
      call.headers.get('authorization'),
      call.headers.get('x-site-id'),
    ]);
    const required = run.data.map(() => ['POST', VISACAL_DATA_AUTH, CAL_WEB_SITE_ID]);
    expect(sent).toEqual(required);
    const accounts = run.result.accounts ?? [];
    const balances = accounts.map(account => [account.accountNumber, account.balance]);
    const expected = VISACAL_MOCK_CARDS.map(card => [card.last4Digits, card.nextTotalDebit]);
    expect(balances).toEqual(expected);
  });

  it('resumes from the stored hash without sending the password or launching a browser', async () => {
    const creds = { ...VISACAL_MOCK_CREDS, otpLongTermToken: SYN_STORED_HASH };
    const run = await runCal(creds);
    expect(run.result.success).toBe(true);
    expect(run.launches).toBe(0);
    expect(run.steps).toEqual(['bioLogin']);
    const isHashSent = isSent(run.calls, SYN_STORED_HASH);
    const isPasswordSent = isSent(run.calls, VISACAL_MOCK_CREDS.password);
    expect(isHashSent).toBe(true);
    expect(isPasswordSent).toBe(false);
  });

  it('falls back to exactly one password login when the stored hash is stale', async () => {
    const creds = { ...VISACAL_MOCK_CREDS, otpLongTermToken: 'syn-cal-stale-hash' };
    const run = await runCal(creds);
    expect(run.result.success).toBe(true);
    expect(run.steps).toEqual(['bioLogin', 'regularLogin', 'bioLogin']);
    expect(run.result.persistentOtpToken).toBe(COLD_RUN_HASH);
  });

  it('fails a refused password as InvalidPassword before any data call', async () => {
    const run = await runCal({ ...VISACAL_MOCK_CREDS, password: 'synthetic-wrong-pass' });
    expect(run.result.success).toBe(false);
    expect(run.result.errorType).toBe(ScraperErrorTypes.InvalidPassword);
    expect(run.result.errorMessage).toBe('login outcome 4');
    expect(run.steps).toEqual(['regularLogin']);
    expect(run.data).toHaveLength(0);
  });

  it('never sends a malformed stored token and logs in cold instead', async () => {
    const run = await runCal({ ...VISACAL_MOCK_CREDS, otpLongTermToken: MALFORMED_TOKEN });
    expect(run.result.success).toBe(true);
    expect(run.steps).toEqual(['regularLogin', 'bioLogin']);
    const isTokenSent = isSent(run.calls, 'syn-malformed');
    expect(isTokenSent).toBe(false);
  });

  it.each(STEP_ZERO_FAULTS)(
    'fails a step-0 %s after one call, with no retry and no response text',
    async (fault, errorType, message) => {
      const run = await runCal({ ...VISACAL_MOCK_CREDS }, fault);
      expect(run.result.success).toBe(false);
      expect(run.result.errorType).toBe(errorType);
      expect(run.result.errorMessage).toBe(message);
      expect(run.calls).toHaveLength(1);
    },
  );

  it('rejects an empty password before sending any request', async () => {
    const run = await runCal({ ...VISACAL_MOCK_CREDS, password: '' });
    expect(run.result.success).toBe(false);
    expect(run.result.errorType).toBe(ScraperErrorTypes.Generic);
    expect(run.result.errorMessage).toBe('Missing or malformed credentials: password');
    expect(run.calls).toHaveLength(0);
  });
});
