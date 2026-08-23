/**
 * Account-identity extraction failure contract — unit coverage for
 * {@link fetchAccounts}.
 *
 * <p>Shapes reject an unusable account identity by throwing (see the FIBI
 * group factory, which refuses a missing accountType, account number or
 * branch rather than defaulting them onto the wire). `fetchAccounts` must
 * convert that throw into a failed `Procedure`: an escaping exception would
 * bypass `runScrapeWithRecovery`, so a warm session that served a degraded
 * identity body would abort the whole multi-account scrape instead of
 * re-logging in and retrying once. `isScrapeSuspicious` keys on a failed
 * Procedure, so the conversion is what keeps that recovery path reachable.
 *
 * <p>The boundary must also survive a non-`Error` throw. JavaScript allows
 * throwing any value, and a `Symbol` throws a second time the moment it is
 * interpolated into the failure message — escaping the catch block that was
 * supposed to contain it. Normalising through `toError` is what prevents that.
 */

import ScraperError from '../../../../../Scrapers/Base/ScraperError.js';
import type { IDriverCtx } from '../../../../../Scrapers/Pipeline/Phases/ApiDirectScrape/ApiDirectScrapeDispatchArgs.js';
import { fetchAccounts } from '../../../../../Scrapers/Pipeline/Phases/ApiDirectScrape/ApiDirectScrapeSteps.js';
import { isOk } from '../../../../../Scrapers/Pipeline/Types/Procedure.js';

/**
 * Post-login session context stand-in — the extract boundary never reads it.
 * @returns Empty session context.
 */
function emptySessionContext(): Record<string, never> {
  return {};
}

/**
 * Build a driver whose customer step skips the fetch and whose extractor
 * behaves as instructed, so the test exercises only the extract boundary.
 * @param extractAccounts - Extractor stand-in.
 * @returns Minimal driver context.
 */
function driverWith(extractAccounts: () => readonly string[]): IDriverCtx<string, number> {
  const customer = { skipFetch: true, extractAccounts };
  const bus = { getSessionContext: emptySessionContext };
  return { shape: { customer }, bus } as unknown as IDriverCtx<string, number>;
}

describe('fetchAccounts identity-extraction failure contract', () => {
  it('converts a shape rejection into a failed Procedure instead of throwing', async () => {
    const d = driverWith(() => {
      throw new ScraperError('FIBI userData row is missing its branch code');
    });
    const result = await fetchAccounts(d);
    const isSuccess = isOk(result);
    expect(isSuccess).toBe(false);
  });

  it('surfaces the shape rejection reason in the failure message', async () => {
    const d = driverWith(() => {
      throw new ScraperError('FIBI userData row is missing its branch code');
    });
    const result = await fetchAccounts(d);
    const message = isOk(result) ? '' : result.errorMessage;
    expect(message).toMatch(/extractAccounts threw: .*missing its branch code/);
  });

  it('converts a non-Error throw into a failed Procedure', async () => {
    const unstringifiable: unknown = Symbol('unstringifiable');
    const d = driverWith(() => {
      throw unstringifiable;
    });
    const result = await fetchAccounts(d);
    const isSuccess = isOk(result);
    expect(isSuccess).toBe(false);
  });

  it('still succeeds when the extractor returns accounts', async () => {
    const d = driverWith(() => ['acct-1']);
    const result = await fetchAccounts(d);
    const accounts = isOk(result) ? result.value : [];
    expect(accounts).toEqual(['acct-1']);
  });
});
