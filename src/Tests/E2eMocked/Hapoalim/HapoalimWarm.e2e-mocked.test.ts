/**
 * Hapoalim warm start — mocked E2E. A cold run publishes its session as a
 * stored token; a later run handed that token signs in with no login call and
 * no SMS. An expired session falls back to one cold run that carries none of
 * the stored or refused cookies; a token for another account, another
 * provider or of the wrong shape is skipped for a cold run; a warm session
 * lost mid-scrape resumes once without SMS, and a persistent rejection ends
 * the run.
 *
 * Rule #18: all credentials + data are synthetic; no real PII.
 */

import { ScraperErrorTypes } from '../../../Scrapers/Base/ErrorTypes.js';
import type { IScraperScrapingResult } from '../../../Scrapers/Base/Interface.js';
import type { HapoalimFault } from './HapoalimFaults.js';
import { HP_PHONE } from './HapoalimMockData.js';
import type { IHapoalimRun } from './HapoalimRun.js';
import {
  ACCOUNT_OPEN_TRAIL,
  ACCOUNTS_TRAIL,
  LANDING_TRAIL,
  runHapoalim,
  SCRAPE_TRAIL,
  SIGNED_IN_TRAIL,
} from './HapoalimRun.js';
import { STALE_TOKENS } from './HapoalimWarmTokens.js';

/** What the cold run each warm run starts from produced. */
interface IColdRun {
  token: string;
  accounts: IScraperScrapingResult['accounts'];
}

/**
 * Scrape with a stored token.
 * @param token - The token handed to the run.
 * @param fault - How the bank misbehaves.
 * @returns What the run sent, received and asked for.
 */
function runWarm(token: string, fault: HapoalimFault = 'none'): Promise<IHapoalimRun> {
  return runHapoalim(fault, { creds: { otpLongTermToken: token } });
}

describe('Hapoalim warm start', () => {
  const cold: IColdRun = { token: '', accounts: [] };

  beforeAll(async (): Promise<void> => {
    const run = await runHapoalim();
    cold.token = run.result.persistentOtpToken ?? '';
    cold.accounts = run.result.accounts;
  });

  it('publishes the session as a stored token after a cold run', () => {
    expect(cold.token).toMatch(/^v1\.[\w-]+$/);
  });

  it('signs in warm with no login call and no SMS, and reads the same data', async () => {
    const run = await runWarm(cold.token);
    expect(run.result.success).toBe(true);
    expect(run.trail).toEqual([...LANDING_TRAIL, ...SCRAPE_TRAIL]);
    expect(run.hints).toEqual([]);
    expect(run.result.accounts).toEqual(cold.accounts);
    expect(run.result.persistentOtpToken).toMatch(/^v1\./);
  });

  it('falls back to one cold run when the stored session expired, carrying none of its cookies', async () => {
    const run = await runWarm(cold.token, 'sessionExpired');
    const coldBootstrapCookie = run.calls[1].headers.get('cookie');
    expect(run.result.success).toBe(true);
    expect(run.trail).toEqual([...LANDING_TRAIL, ...SIGNED_IN_TRAIL, ...SCRAPE_TRAIL]);
    expect(run.hints).toEqual([HP_PHONE]);
    expect(coldBootstrapCookie).toBeNull();
  });

  it.each(STALE_TOKENS)('skips $label and signs in cold', async stale => {
    const token = stale.build(cold.token);
    const run = await runWarm(token);
    expect(run.result.success).toBe(true);
    expect(run.trail).toEqual([...SIGNED_IN_TRAIL, ...SCRAPE_TRAIL]);
    expect(run.hints).toEqual([HP_PHONE]);
  });

  it('resumes once without SMS when a warm session is lost mid-scrape, then fails', async () => {
    const run = await runWarm(cold.token, 'expire401');
    const lostScrape = [...ACCOUNTS_TRAIL, ...ACCOUNT_OPEN_TRAIL];
    expect(run.result.success).toBe(false);
    expect(run.result.errorType).toBe(ScraperErrorTypes.Generic);
    expect(run.trail).toEqual([...LANDING_TRAIL, ...lostScrape, ...LANDING_TRAIL, ...lostScrape]);
    expect(run.hints).toEqual([]);
  });
});
