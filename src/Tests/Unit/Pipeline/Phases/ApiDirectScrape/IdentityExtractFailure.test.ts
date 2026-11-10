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

import { jest } from '@jest/globals';

import { ScraperErrorTypes } from '../../../../../Scrapers/Base/ErrorTypes.js';
import ScraperError from '../../../../../Scrapers/Base/ScraperError.js';
import { fetchAccounts } from '../../../../../Scrapers/Pipeline/Phases/ApiDirectScrape/ApiDirectScrapeSteps.js';
import type { IDriverCtx } from '../../../../../Scrapers/Pipeline/Phases/ApiDirectScrape/ApiDirectScrapeTypes.js';
import { fail, isOk, succeed } from '../../../../../Scrapers/Pipeline/Types/Procedure.js';

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

/** A secondary identity body that reports an expired session. */
const EXPIRED_BODY = { Header: { Status: '-2' } };

/**
 * Answer the secondary identity GET with the expired body.
 * @returns The bus reply.
 */
async function expiredReply(): Promise<ReturnType<typeof succeed>> {
  await Promise.resolve();
  return succeed(EXPIRED_BODY);
}

/**
 * A shape check that rejects every body.
 * @returns The failure.
 */
function rejectBody(): ReturnType<typeof fail> {
  return fail(ScraperErrorTypes.Generic, 'expired');
}

/**
 * Build a driver whose secondary identity GET returns the expired body and
 * whose shape check rejects it.
 * @param extractAccounts - The shape extractor, which must not run.
 * @param omitBankText - Whether to omit failure text from the bank.
 * @returns Driver context.
 */
function driverWithRejectedSecondary(
  extractAccounts: () => readonly string[],
  omitBankText = false,
): IDriverCtx<string, number> {
  const customer = { skipFetch: true, secondaryUrlTag: 'data.customerSecondary', extractAccounts };
  const bus = { getSessionContext: emptySessionContext, apiGet: expiredReply };
  return { shape: { customer, checkBody: rejectBody, omitBankText }, bus } as unknown as IDriverCtx<
    string,
    number
  >;
}

/** A transport failure quoting the bank's reply, as the classifier words it. */
const QUOTED_SECONDARY_FAILURE = fail(
  ScraperErrorTypes.Generic,
  'GET https://api.bank.example/v1/customer 500: SYN bank notice 7731',
);

/**
 * Answer the secondary identity GET with a quoting transport failure.
 * @returns The bus reply.
 */
async function quotedReply(): Promise<ReturnType<typeof fail>> {
  await Promise.resolve();
  return QUOTED_SECONDARY_FAILURE;
}

/**
 * A shape extractor that must not run, since the secondary call fails first.
 * @returns One synthetic account.
 */
function oneAccount(): readonly string[] {
  return ['acct-1'];
}

/**
 * Build a driver whose secondary identity GET fails with a quoting transport
 * message, for a bank that omits its text.
 * @returns Driver context.
 */
function driverWithQuotedSecondary(): IDriverCtx<string, number> {
  const customer = {
    skipFetch: true,
    secondaryUrlTag: 'data.customerSecondary',
    extractAccounts: oneAccount,
  };
  const bus = { getSessionContext: emptySessionContext, apiGet: quotedReply };
  return { shape: { customer, omitBankText: true }, bus } as unknown as IDriverCtx<string, number>;
}

describe('fetchAccounts secondary identity body check', () => {
  it('fails when the shape check rejects the secondary identity body', async () => {
    const extractAccounts = jest.fn((): readonly string[] => ['acct-1']);
    const d = driverWithRejectedSecondary(extractAccounts);
    const result = await fetchAccounts(d);
    const message = isOk(result) ? '' : result.errorMessage;
    expect(message).toBe('expired');
    expect(extractAccounts).not.toHaveBeenCalled();
  });

  it('keeps a secondary identity refusal when the bank opts in', async () => {
    // The shape's own refusal never quotes the bank's text, so the bank-text
    // rule leaves it intact; it rewrites only a failed transport call.
    const driver = driverWithRejectedSecondary(() => ['acct-1'], true);
    const result = await fetchAccounts(driver);
    expect(result).toMatchObject({ success: false, errorMessage: 'expired' });
  });

  it('strips bank text from a failed secondary identity call when the bank opts in', async () => {
    const driver = driverWithQuotedSecondary();
    const result = await fetchAccounts(driver);
    expect(result).toMatchObject({ success: false, errorMessage: 'customer HTTP 500' });
  });
});
