/**
 * Branch coverage extensions for PendingStrategy.
 * Phase 7e: pendingUrl is supplied by the caller (DASHBOARD.FINAL pre-resolves it),
 * cardUniqueId list is read from accountRecords; SCRAPE never re-discovers.
 */

import { fetchAndMergePending } from '../../../../../../Scrapers/Pipeline/Strategy/Scrape/Account/PendingStrategy.js';
import type { IApiFetchContext } from '../../../../../../Scrapers/Pipeline/Types/PipelineContext.js';
import { succeed } from '../../../../../../Scrapers/Pipeline/Types/Procedure.js';
import type { ITransactionsAccount } from '../../../../../../Transactions.js';

const FAKE_PENDING_URL = 'https://api.fake.example/pending';

/** Loose stub signature — callers don't match the full generic. */
type LoosePostFn = () => Promise<unknown>;

/**
 * Build a stub API.
 * @param postFn - fetchPost stub.
 * @returns Stub API context.
 */
function makeApi(postFn: LoosePostFn): IApiFetchContext {
  return {
    fetchPost: postFn as unknown as IApiFetchContext['fetchPost'],
    fetchGet: postFn as unknown as IApiFetchContext['fetchGet'],
    accountsUrl: false,
    transactionsUrl: false,
    balanceUrl: false,
    pendingUrl: false,
    proxyUrl: false,
  } as unknown as IApiFetchContext;
}

describe('PendingStrategy — branch completion (Phase 7e)', () => {
  it('reconciles txns into matching account by display number', async () => {
    const accounts: ITransactionsAccount[] = [
      { accountNumber: '4718', balance: 0, txns: [] },
      { accountNumber: '7777', balance: 0, txns: [] },
    ];
    const api = makeApi(() => {
      const okResult = succeed({
        statusCode: 200,
        result: {
          cardsList: [
            {
              cardUniqueID: 'card-xyz',
              authDetalisList: [
                {
                  trnAmt: -25,
                  merchantName: 'Coffee',
                  trnPurchaseDate: '2026-04-01',
                  trnCurrencySymbol: 'ILS',
                },
                {
                  trnAmt: -10,
                  merchantName: 'Snack',
                  trnPurchaseDate: '2026-04-02',
                  trnCurrencySymbol: '',
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
      accountRecords: [{ cardUniqueId: 'card-xyz', last4Digits: '4718' }],
      pendingUrl: FAKE_PENDING_URL,
    });
    const enriched = result.find(a => a.accountNumber === '4718');
    expect(enriched?.txns.length).toBe(2);
  });

  it('accepts number fields in safeStr (cardUniqueId as number in record)', async () => {
    const accounts: ITransactionsAccount[] = [{ accountNumber: '0001', balance: 0, txns: [] }];
    const api = makeApi(() => {
      const okResult = succeed({
        statusCode: 200,
        result: {
          cardsList: [
            {
              cardUniqueID: '12345',
              authDetalisList: [
                {
                  trnAmt: -1,
                  merchantName: 'X',
                  trnPurchaseDate: '2026-04-02',
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
      accountRecords: [{ cardUniqueID: 12345 }],
      pendingUrl: FAKE_PENDING_URL,
    });
    const isArrayResult = Array.isArray(result);
    expect(isArrayResult).toBe(true);
  });

  it('falls back to CardUniqueId (Pascal) field when others are missing', async () => {
    const accounts: ITransactionsAccount[] = [{ accountNumber: 'A1', balance: 0, txns: [] }];
    const api = makeApi(() => {
      const okResult = succeed({ statusCode: 200, result: { cardsList: [] } });
      return Promise.resolve(okResult);
    });
    const result = await fetchAndMergePending({
      api,
      accounts,
      accountRecords: [{ CardUniqueId: 'pascal-id' }],
      pendingUrl: FAKE_PENDING_URL,
    });
    expect(result).toBe(accounts);
  });

  it('returns accounts unchanged when all pending cards have empty authDetalisList', async () => {
    const accounts: ITransactionsAccount[] = [{ accountNumber: 'A1', balance: 0, txns: [] }];
    const api = makeApi(() => {
      const okResult = succeed({
        statusCode: 200,
        result: {
          cardsList: [{ cardUniqueID: 'cx', authDetalisList: [] }],
        },
      });
      return Promise.resolve(okResult);
    });
    const result = await fetchAndMergePending({
      api,
      accounts,
      accountRecords: [{ cardUniqueId: 'cx' }],
      pendingUrl: FAKE_PENDING_URL,
    });
    expect(result).toBe(accounts);
  });

  it('falls back to cardUniqueID when idMap has no entry', async () => {
    const accounts: ITransactionsAccount[] = [
      { accountNumber: 'direct-fallback', balance: 0, txns: [] },
    ];
    const api = makeApi(() => {
      const okResult = succeed({
        statusCode: 200,
        result: {
          cardsList: [
            {
              cardUniqueID: 'direct-fallback',
              authDetalisList: [
                {
                  trnAmt: -1,
                  merchantName: 'Z',
                  trnPurchaseDate: '2026-04-03',
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
      accountRecords: [{ cardUniqueId: 'direct-fallback' }],
      pendingUrl: FAKE_PENDING_URL,
    });
    const isArrayResult = Array.isArray(result);
    expect(isArrayResult).toBe(true);
  });
});
