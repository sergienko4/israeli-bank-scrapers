/**
 * Yahav warm start — mocked E2E. A cold run publishes the enrolled device
 * (app client, certificate, key, device handle, gateway cookies) as a stored
 * token; a later run handed it resumes at the token call with no client
 * initialize and no device registration. A device the bank refuses (401/403)
 * buys one cold login; any other token failure ends the run without enrolling
 * a new device; a token the warm start cannot use is skipped for a cold run.
 *
 * Rule #18: all credentials + data are synthetic; no real PII.
 */

import type { IScraperScrapingResult } from '../../../Scrapers/Base/Interface.js';
import type { YahavFault } from './YahavFaults.js';
import { YH_INIT_COOKIE, YH_REG_COOKIE } from './YahavMockData.js';
import { COLD_TRAIL, cookiesOf, foldedTrail, runWarm, runYahav, WARM_TRAIL } from './YahavRun.js';
import { STALE_TOKENS } from './YahavWarmTokens.js';

/** What the cold run each warm run starts from produced. */
interface IColdRun {
  token: string;
  accounts: IScraperScrapingResult['accounts'];
}

const REFUSED: readonly YahavFault[] = ['token401', 'token403'];

const BROKEN: readonly YahavFault[] = ['token400', 'token500', 'tokenTimeout'];

const GATEWAY_COOKIES = [YH_INIT_COOKIE, YH_REG_COOKIE].sort();

describe('Yahav warm start', () => {
  const cold: IColdRun = { token: '', accounts: [] };

  beforeAll(async (): Promise<void> => {
    const run = await runYahav();
    cold.token = run.result.persistentOtpToken ?? '';
    cold.accounts = run.result.accounts;
  });

  it('publishes the enrolled device as a v1 carry bundle', () => {
    expect(cold.token).toMatch(/^v1\.[\w-]+$/);
  });

  it('resumes at the token call with the stored device and gateway cookies, and reads the same data', async () => {
    const run = await runWarm(cold.token);
    const trail = foldedTrail(run);
    const tokenCookies = cookiesOf(run.calls[0]);
    expect(run.state.violations).toEqual([]);
    expect(run.result.success).toBe(true);
    expect(trail).toEqual(WARM_TRAIL);
    expect(tokenCookies).toEqual(GATEWAY_COOKIES);
    expect(run.result.accounts).toEqual(cold.accounts);
    expect(run.result.persistentOtpToken).toMatch(/^v1\./);
    expect(run.launches).toBe(0);
  });

  it.each(REFUSED)(
    'enrols once, cold and cookieless, when the bank refuses the stored device (%s)',
    async fault => {
      const run = await runWarm(cold.token, fault);
      const trail = foldedTrail(run);
      const initializeCookies = cookiesOf(run.calls[1]);
      expect(run.state.violations).toEqual([]);
      expect(run.result.success).toBe(true);
      expect(trail).toEqual(['token', ...COLD_TRAIL]);
      expect(initializeCookies).toEqual([]);
    },
  );

  it.each(BROKEN)(
    'fails without enrolling a new device when the token call breaks (%s)',
    async fault => {
      const run = await runWarm(cold.token, fault);
      expect(run.state.violations).toEqual([]);
      expect(run.result.success).toBe(false);
      expect(run.trail).toEqual(['token']);
    },
  );

  it.each(STALE_TOKENS)('skips $label and signs in cold', async stale => {
    const staleToken = stale.build(cold.token);
    const run = await runWarm(staleToken);
    const trail = foldedTrail(run);
    expect(run.state.violations).toEqual([]);
    expect(run.result.success).toBe(true);
    expect(trail).toEqual(COLD_TRAIL);
  });
});
