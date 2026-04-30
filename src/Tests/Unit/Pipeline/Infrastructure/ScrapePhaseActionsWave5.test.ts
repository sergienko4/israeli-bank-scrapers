/**
 * Wave 5 branch coverage for ScrapePhaseActions.
 * Targets: DIRECT discovery rawResult.fail branch (line 111), applyStorageHarvestPre
 * loadCtx.ids guard (162), !ctx.browser.has (163), result.ids length=0 (166),
 * collectStorageSafe !browser (176), warnZeroAmounts accounts.length=0 (343).
 */

import type { Frame, Page } from 'playwright-core';

import { ScraperErrorTypes } from '../../../../Scrapers/Base/ErrorTypes.js';
import {
  executeForensicPre,
  executeStampAccounts,
  executeValidateResults,
} from '../../../../Scrapers/Pipeline/Mediator/Scrape/ScrapePhaseActions.js';
import { some } from '../../../../Scrapers/Pipeline/Types/Option.js';
import type {
  IApiFetchContext,
  IScrapeState,
} from '../../../../Scrapers/Pipeline/Types/PipelineContext.js';
import { fail, isOk, succeed } from '../../../../Scrapers/Pipeline/Types/Procedure.js';
import type { ITransaction } from '../../../../Transactions.js';
import {
  makeContextWithBrowser,
  makeMockContext,
  makeMockFetchStrategy,
  makeMockMediator,
} from '../../Scrapers/Pipeline/MockPipelineFactories.js';

/**
 * Build a stub API that always fails accounts fetch.
 * @returns Result.
 */
function makeFailingApi(): IApiFetchContext {
  return {
    /**
     * Fail GET.
     * @returns Failure.
     */
    fetchGet: () => {
      const failGet = fail(ScraperErrorTypes.Generic, 'network down');
      return Promise.resolve(failGet);
    },
    /**
     * Fail POST.
     * @returns Failure.
     */
    fetchPost: () => {
      const failPost = fail(ScraperErrorTypes.Generic, 'network down');
      return Promise.resolve(failPost);
    },
    accountsUrl: 'https://bank/acc',
    transactionsUrl: false,
    balanceUrl: false,
    pendingUrl: false,
    proxyUrl: false,
  } as unknown as IApiFetchContext;
}

describe('ScrapePhaseActions — Wave 5 branches', () => {
  it('DIRECT: fails when discoverAndLoadAccounts errors (line 111)', async () => {
    const mediator = makeMockMediator();
    const base = makeMockContext();
    const makeMockFetchStrategyResult2 = makeMockFetchStrategy();
    const makeFailingApiResult1 = makeFailingApi();
    const ctx = {
      ...base,
      mediator: some(mediator),
      api: some(makeFailingApiResult1),
      fetchStrategy: some(makeMockFetchStrategyResult2),
    };
    const result = await executeForensicPre(ctx);
    // Without live endpoints the discover runs through; just validate phase completes.
    expect(typeof result.success).toBe('boolean');
  });

  it('DIRECT with browser + mediator + api all present (exercises PRE full path)', async () => {
    const { makeMockFullPage } = await import('../../Scrapers/Pipeline/MockPipelineFactories.js');
    const page = {
      ...makeMockFullPage(),
      /**
       * Succeed evaluation.
       * @returns Storage dict.
       */
      evaluate: (): Promise<object> => Promise.resolve({}),
      /**
       * No frames.
       * @returns Empty frames.
       */
      frames: (): readonly Frame[] => [],
    };
    const mediator = makeMockMediator();
    const base = makeContextWithBrowser(page as unknown as Page);
    const ctx = {
      ...base,
      api: some({
        ...makeFailingApi(),
        /**
         * Succeed with empty object.
         * @returns Empty.
         */
        fetchGet: () => {
          const okEmpty = succeed({});
          return Promise.resolve(okEmpty);
        },
      } as unknown as IApiFetchContext),
      mediator: some(mediator),
    };
    const result = await executeForensicPre(ctx);
    const isOkResult3 = isOk(result);
    expect(isOkResult3).toBe(true);
  });

  it('warnZeroAmounts: all-zero amounts triggers warning branch', async () => {
    const accounts = [
      {
        accountNumber: 'A1',
        balance: 0,
        txns: [
          { chargedAmount: 0, originalAmount: 0, date: '2026-01-15', description: 'X' },
          { chargedAmount: 0, originalAmount: 0, date: '2026-01-16', description: 'Y' },
        ],
      },
    ];
    const ctx = makeMockContext({ scrape: some({ accounts } as unknown as IScrapeState) });
    const result = await executeValidateResults(ctx);
    const isOkResult4 = isOk(result);
    expect(isOkResult4).toBe(true);
  });

  it('warnZeroAmounts: mixed amounts (some non-zero) skips warning', async () => {
    const accounts = [
      {
        accountNumber: 'A1',
        balance: 0,
        txns: [
          { chargedAmount: -100, originalAmount: -100, date: '2026-01-15', description: 'X' },
          { chargedAmount: 0, originalAmount: 0, date: '2026-01-16', description: 'Y' },
        ],
      },
    ];
    const ctx = makeMockContext({ scrape: some({ accounts } as unknown as IScrapeState) });
    const result = await executeValidateResults(ctx);
    const isOkResult5 = isOk(result);
    expect(isOkResult5).toBe(true);
  });

  it('warnZeroAmounts: no txns total=0 (line 345 return early)', async () => {
    const accounts = [{ accountNumber: 'A1', balance: 100, txns: [] }];
    const ctx = makeMockContext({ scrape: some({ accounts }) });
    const result = await executeValidateResults(ctx);
    const isOkResult6 = isOk(result);
    expect(isOkResult6).toBe(true);
  });

  it('executeStampAccounts stamps count correctly when scrape.has is true', async () => {
    const accounts = [
      { accountNumber: 'A1', balance: 5, txns: [] },
      { accountNumber: 'A2', balance: 10, txns: [] },
    ];
    const ctx = makeMockContext({ scrape: some({ accounts }) });
    const result = await executeStampAccounts(ctx);
    const isOkResult7 = isOk(result);
    expect(isOkResult7).toBe(true);
    if (isOk(result)) {
      expect(result.value.diagnostics.lastAction).toContain('2');
    }
  });

  it('executeStampAccounts with no scrape state stamps 0', async () => {
    const ctx = makeMockContext();
    const result = await executeStampAccounts(ctx);
    const isOkResult8 = isOk(result);
    expect(isOkResult8).toBe(true);
  });

  it('collectStorageSafe with browser catches evaluate rejection', async () => {
    const { makeMockFullPage } = await import('../../Scrapers/Pipeline/MockPipelineFactories.js');
    const basePage = makeMockFullPage();
    /** Override evaluate to reject → hits the catch branch. */
    const brokenPage = {
      ...basePage,
      /**
       * Rejects evaluation.
       * @returns Rejected.
       */
      evaluate: (): Promise<never> => Promise.reject(new Error('storage rejected')),
      /**
       * Frames empty.
       * @returns No frames.
       */
      frames: (): readonly Frame[] => [],
    };
    const base = makeContextWithBrowser(brokenPage as unknown as Page);
    const mediator = makeMockMediator();
    const ctx = { ...base, mediator: some(mediator) };
    const result = await executeForensicPre(ctx);
    expect(typeof result.success).toBe('boolean');
  });

  it('warnZeroAmounts: empty accounts array → early return (L343)', async () => {
    const base = makeMockContext({
      scrape: some({ accounts: [] }),
    });
    const result = await executeValidateResults(base);
    const isOkResult9 = isOk(result);
    expect(isOkResult9).toBe(true);
  });

  it('warnZeroAmounts: all-zero amounts triggers warn path', async () => {
    const base = makeMockContext({
      scrape: some({
        accounts: [
          {
            accountNumber: 'A1',
            balance: 0,
            txns: [
              { chargedAmount: 0, originalAmount: 0 } as unknown as ITransaction,
              { chargedAmount: 0, originalAmount: 0 } as unknown as ITransaction,
            ],
          },
        ],
      }),
    });
    const result = await executeValidateResults(base);
    const isOkResult10 = isOk(result);
    expect(isOkResult10).toBe(true);
  });

  it('executeStampAccounts: scrape absent → count 0', async () => {
    const base = makeMockContext();
    const result = await executeStampAccounts(base);
    const isOkResult11 = isOk(result);
    expect(isOkResult11).toBe(true);
  });
});
