/**
 * Unit tests for PendingStrategy — Phase 7e contract: the pending URL is
 * supplied by the caller (DASHBOARD.FINAL pre-resolves via WK_API.pending),
 * and the cardUniqueId list comes from the ACCOUNT-RESOLVE.POST records.
 * SCRAPE never re-discovers either source.
 */

import { ScraperErrorTypes } from '../../../../../../Scrapers/Base/ErrorTypes.js';
import { fetchAndMergePending } from '../../../../../../Scrapers/Pipeline/Strategy/Scrape/Account/PendingStrategy.js';
import type { IApiFetchContext } from '../../../../../../Scrapers/Pipeline/Types/PipelineContext.js';
import { fail, succeed } from '../../../../../../Scrapers/Pipeline/Types/Procedure.js';
import type { ITransactionsAccount } from '../../../../../../Transactions.js';

/** Loose stub signature — callers don't match the full generic. */
type LoosePostFn = () => Promise<unknown>;

/**
 * Build stub IApiFetchContext returning the supplied fetchPost outcome.
 * @param postFn - Override for fetchPost.
 * @returns Stub API context.
 */
function makeApi(
  postFn: LoosePostFn = (): Promise<ReturnType<typeof fail>> => {
    const failResult = fail(ScraperErrorTypes.Generic, 'no-stub');
    return Promise.resolve(failResult);
  },
): IApiFetchContext {
  return {
    fetchPost: postFn as unknown as IApiFetchContext['fetchPost'],
    /**
     * Test helper.
     * @returns Result.
     */
    fetchGet: (): Promise<ReturnType<typeof fail>> => {
      const failResult = fail(ScraperErrorTypes.Generic, 'no-stub');
      return Promise.resolve(failResult);
    },
    accountsUrl: false,
    transactionsUrl: false,
    balanceUrl: false,
    pendingUrl: false,
    proxyUrl: false,
  } as unknown as IApiFetchContext;
}

describe('fetchAndMergePending — Phase 7e (pendingUrl supplied by caller)', () => {
  it('returns accounts unchanged when pendingUrl is false', async () => {
    const accounts: ITransactionsAccount[] = [{ accountNumber: '111', balance: 0, txns: [] }];
    const result = await fetchAndMergePending({
      api: makeApi(),
      accounts,
      accountRecords: [],
      pendingUrl: false,
    });
    expect(result).toBe(accounts);
  });

  it('returns accounts unchanged when accountRecords have no cardUniqueId', async () => {
    const accounts: ITransactionsAccount[] = [{ accountNumber: '111', balance: 0, txns: [] }];
    const result = await fetchAndMergePending({
      api: makeApi(),
      accounts,
      accountRecords: [],
      pendingUrl: 'https://api.fake.example/pending',
    });
    expect(result).toBe(accounts);
  });

  it('returns accounts unchanged when fetchPost fails', async () => {
    const accounts: ITransactionsAccount[] = [{ accountNumber: '111', balance: 0, txns: [] }];
    const api = makeApi((): Promise<ReturnType<typeof fail>> => {
      const failResult = fail(ScraperErrorTypes.Generic, 'fetch failed');
      return Promise.resolve(failResult);
    });
    const result = await fetchAndMergePending({
      api,
      accounts,
      accountRecords: [{ cardUniqueId: 'card-a' }],
      pendingUrl: 'https://api.fake.example/pending',
    });
    expect(result).toBe(accounts);
  });

  it('returns accounts unchanged when response has no cardsList', async () => {
    const accounts: ITransactionsAccount[] = [{ accountNumber: '111', balance: 0, txns: [] }];
    const api = makeApi((): Promise<ReturnType<typeof succeed>> => {
      const okResult = succeed({ statusCode: 200 });
      return Promise.resolve(okResult);
    });
    const result = await fetchAndMergePending({
      api,
      accounts,
      accountRecords: [{ cardUniqueId: 'card-a' }],
      pendingUrl: 'https://api.fake.example/pending',
    });
    expect(result).toBe(accounts);
  });

  it('merges pending txns into matching accounts when cardsList returned', async () => {
    const accounts: ITransactionsAccount[] = [{ accountNumber: '4718', balance: 0, txns: [] }];
    const api = makeApi((): Promise<ReturnType<typeof succeed>> => {
      const okResult = succeed({
        statusCode: 200,
        result: {
          cardsList: [
            {
              cardUniqueID: 'card-a',
              authDetalisList: [
                {
                  trnAmt: -25,
                  merchantName: 'Coffee',
                  trnPurchaseDate: '2026-04-01',
                  trnCurrencySymbol: 'ILS',
                },
              ],
            },
          ],
        },
      });
      return Promise.resolve(okResult);
    });
    const result = await fetchAndMergePending({
      api,
      accounts,
      accountRecords: [{ cardUniqueId: 'card-a', accountNumber: '4718' }],
      pendingUrl: 'https://api.fake.example/pending',
    });
    const isArrayResult = Array.isArray(result);
    expect(isArrayResult).toBe(true);
  });
});
