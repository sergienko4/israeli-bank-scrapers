/**
 * Mizrahi browserless login — mocked E2E for the outcomes: a cold run over
 * both hosts with no browser, each login refusal, a refused replay, the
 * logon envelope, an empty page, a lost session and every way step 0 can
 * fail. The wire itself (cookies, hops, headers) lives in MizrahiWire.
 *
 * Rule #18: all credentials + data are synthetic; no real PII.
 */

import { ScraperErrorTypes } from '../../../Scrapers/Base/ErrorTypes.js';
import type { ScraperCredentials } from '../../../Scrapers/Base/Interface.js';
import type { MizrahiFault } from './MizrahiFetchMock.js';
import { MZ_BANK_NOTICE, MZ_LOGIN_REPLAY_URL } from './MizrahiFetchMock.js';
import { MIZRAHI_MOCK_ACCOUNTS, MIZRAHI_MOCK_CREDS } from './MizrahiMockData.js';
import {
  ACCOUNT_OPEN_TRAIL,
  ACCOUNT_TRAIL,
  HANDOFF_TRAIL,
  LOGIN_TRAIL,
  runMizrahi,
} from './MizrahiRun.js';

/** A login Mizrahi refuses: the input, the failure it must surface. */
interface IRefusal {
  readonly name: string;
  readonly creds: ScraperCredentials;
  readonly fault: MizrahiFault;
  readonly errorType: ScraperErrorTypes;
  readonly message: string;
}

/** Refused logins and the failure each must surface, before the handoff. */
const REFUSALS: readonly IRefusal[] = [
  {
    name: 'a wrong password',
    creds: { ...MIZRAHI_MOCK_CREDS, password: 'synthetic-wrong-pass' },
    fault: 'none',
    errorType: ScraperErrorTypes.InvalidPassword,
    message: 'login outcome 2',
  },
  {
    name: 'a password Mizrahi wants changed',
    creds: { ...MIZRAHI_MOCK_CREDS },
    fault: 'changePassword',
    errorType: ScraperErrorTypes.ChangePassword,
    message: 'login outcome 4',
  },
  {
    name: 'a blocked account',
    creds: { ...MIZRAHI_MOCK_CREDS },
    fault: 'blocked',
    errorType: ScraperErrorTypes.AccountBlocked,
    message: 'login outcome 5',
  },
  {
    name: 'ReturnCode 19, never observed, without echoing it',
    creds: { ...MIZRAHI_MOCK_CREDS },
    fault: 'code19',
    errorType: ScraperErrorTypes.Generic,
    message: 'login outcome unmapped',
  },
  {
    name: 'ReturnCode 8, never documented, without echoing it',
    creds: { ...MIZRAHI_MOCK_CREDS },
    fault: 'code8',
    errorType: ScraperErrorTypes.Generic,
    message: 'login outcome unmapped',
  },
];

/** Step-0 faults and the failure each must surface, with no response text. */
const STEP_ZERO_FAULTS: readonly (readonly [MizrahiFault, ScraperErrorTypes, string])[] = [
  ['http500', ScraperErrorTypes.Generic, 'bootstrap HTTP 500'],
  ['reject', ScraperErrorTypes.Generic, 'bootstrap GENERIC'],
  ['timeout', ScraperErrorTypes.Timeout, 'bootstrap TIMEOUT'],
];

/** The whole cold trail: login, handoff, then each account's two calls. */
const COLD_TRAIL = [
  ...LOGIN_TRAIL,
  ...HANDOFF_TRAIL,
  ...MIZRAHI_MOCK_ACCOUNTS.flatMap(() => ACCOUNT_TRAIL),
];

describe('Mizrahi browserless login', () => {
  it('signs in cold over both hosts in order and launches no browser', async () => {
    const run = await runMizrahi();
    expect(run.result.success).toBe(true);
    expect(run.launches).toBe(0);
    expect(run.trail).toEqual(COLD_TRAIL);
  });

  it('reports each account with its own balance and movements', async () => {
    const run = await runMizrahi();
    const accounts = run.result.accounts ?? [];
    const summary = accounts.map(account => [
      account.accountNumber,
      account.balance,
      account.txns.map(txn => txn.chargedAmount),
    ]);
    const expected = MIZRAHI_MOCK_ACCOUNTS.map(acct => [acct.number, acct.balance, acct.amounts]);
    expect(summary).toEqual(expected);
  });

  it.each(REFUSALS)('fails $name before the handoff', async (refusal: IRefusal) => {
    const run = await runMizrahi(refusal.fault, refusal.creds);
    expect(run.result.success).toBe(false);
    expect(run.result.errorType).toBe(refusal.errorType);
    expect(run.result.errorMessage).toBe(refusal.message);
    expect(run.trail).toEqual(LOGIN_TRAIL);
  });

  it('refuses a 307 on LoginUser and never replays the credentials', async () => {
    const run = await runMizrahi('login307');
    expect(run.result.success).toBe(false);
    expect(run.result.errorType).toBe(ScraperErrorTypes.Generic);
    expect(run.result.errorMessage).toBe('login HTTP 307 redirect refused');
    expect(run.trail).toEqual(LOGIN_TRAIL);
    const urls = run.calls.map(call => call.url);
    expect(urls).not.toContain(MZ_LOGIN_REPLAY_URL);
  });

  it('fails a logon without xsrfToken by selector, never with the bank text', async () => {
    const run = await runMizrahi('logonNoXsrf');
    expect(run.result.success).toBe(false);
    expect(run.result.errorType).toBe(ScraperErrorTypes.Generic);
    expect(run.result.errorMessage).toBe('envelope selector miss: xsrfToken at /body/xsrfToken');
    expect(run.result.errorMessage).not.toContain(MZ_BANK_NOTICE);
    expect(run.data).toHaveLength(0);
  });

  it('reads an empty 204 movements page as no movements', async () => {
    const run = await runMizrahi('txns204');
    expect(run.result.success).toBe(true);
    const counts = (run.result.accounts ?? []).map(account => account.txns.length);
    expect(counts).toEqual([0, 0]);
  });

  it('fails a lost session mid-scrape without logging in again', async () => {
    const run = await runMizrahi('expire401');
    expect(run.result.success).toBe(false);
    expect(run.result.errorType).toBe(ScraperErrorTypes.Generic);
    expect(run.trail).toEqual([...LOGIN_TRAIL, ...HANDOFF_TRAIL, ...ACCOUNT_OPEN_TRAIL]);
  });

  it.each(STEP_ZERO_FAULTS)(
    'fails a step-0 %s after one call, with no retry and no response text',
    async (fault, errorType, message) => {
      const run = await runMizrahi(fault);
      expect(run.result.success).toBe(false);
      expect(run.result.errorType).toBe(errorType);
      expect(run.result.errorMessage).toBe(message);
      expect(run.calls).toHaveLength(1);
    },
  );

  it('rejects an empty password before sending any request', async () => {
    const run = await runMizrahi('none', { ...MIZRAHI_MOCK_CREDS, password: '' });
    expect(run.result.success).toBe(false);
    expect(run.result.errorType).toBe(ScraperErrorTypes.Generic);
    expect(run.result.errorMessage).toBe('Missing or malformed credentials: password');
    expect(run.calls).toHaveLength(0);
  });
});
