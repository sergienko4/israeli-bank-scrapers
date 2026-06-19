/**
 * Unit tests for ScrapePhaseActions — PRE/ACTION/POST/FINAL orchestration.
 */

import type { IElementMediator } from '../../../../Scrapers/Pipeline/Mediator/Elements/ElementMediator.js';
import type { IDiscoveredEndpoint } from '../../../../Scrapers/Pipeline/Mediator/Network/Types/Endpoint.js';
import {
  executeForensicPre,
  executeMatrixLoop,
  executeStampAccounts,
  executeValidateResults,
} from '../../../../Scrapers/Pipeline/Mediator/Scrape/ScrapePhaseActions.js';
import { some } from '../../../../Scrapers/Pipeline/Types/Option.js';
import type { IScrapeDiscovery } from '../../../../Scrapers/Pipeline/Types/PipelineContext.js';
import { API_STRATEGY } from '../../../../Scrapers/Pipeline/Types/PipelineContext.js';
import { isOk } from '../../../../Scrapers/Pipeline/Types/Procedure.js';
import type { ITransaction } from '../../../../Transactions.js';
import { makePool } from '../../Pipeline/Mediator/BalanceResolve/BalancePoolHelpers.js';
import {
  makeMockContext,
  makeMockMediator,
} from '../../Scrapers/Pipeline/MockPipelineFactories.js';
import { makeMockActionExecutor, toActionCtx } from './TestHelpers.js';

/**
 * Build a minimal scrape discovery.
 * @returns IScrapeDiscovery mock.
 */
function makeDiscovery(): IScrapeDiscovery {
  return {
    qualifiedCards: [],
    prunedCards: [],
    txnTemplateUrl: '',
    txnTemplateBody: {},
    billingMonths: [],
  };
}

describe('executeForensicPre', () => {
  it('runs DIRECT path when no api strategy set (default)', async () => {
    const ctx = makeMockContext();
    const result = await executeForensicPre(ctx);
    const isOkResult1 = isOk(result);
    expect(isOkResult1).toBe(true);
  });

  it('runs DIRECT path when strategy=DIRECT explicitly set', async () => {
    const base = makeMockContext();
    const ctx = {
      ...base,
      diagnostics: { ...base.diagnostics, apiStrategy: API_STRATEGY.DIRECT },
    };
    const result = await executeForensicPre(ctx);
    const isOkResult2 = isOk(result);
    expect(isOkResult2).toBe(true);
  });
});

describe('executeMatrixLoop', () => {
  it('skips frozen scrape when no discovery', async () => {
    const makeMockActionExecutorResult4 = makeMockActionExecutor();
    const makeMockContextResult3 = makeMockContext();
    const ctx = toActionCtx(makeMockContextResult3, makeMockActionExecutorResult4);
    const result = await executeMatrixLoop(ctx);
    const isOkResult5 = isOk(result);
    expect(isOkResult5).toBe(true);
  });

  it('skips when no frozen endpoints', async () => {
    const makeDiscoveryResult6 = makeDiscovery();
    const base = makeMockContext({ scrapeDiscovery: some(makeDiscoveryResult6) });
    const makeMockActionExecutorResult7 = makeMockActionExecutor();
    const ctx = toActionCtx(base, makeMockActionExecutorResult7);
    const result = await executeMatrixLoop(ctx);
    const isOkResult8 = isOk(result);
    expect(isOkResult8).toBe(true);
  });
});

describe('executeValidateResults', () => {
  it('stamps zero-accounts diagnostic when no scrape state', async () => {
    const ctx = makeMockContext();
    const result = await executeValidateResults(ctx);
    const isOkResult9 = isOk(result);
    expect(isOkResult9).toBe(true);
    if (isOk(result)) {
      expect(result.value.diagnostics.lastAction).toContain('0 accounts');
    }
  });

  it('stamps accounts count when scrape state has accounts with txns', async () => {
    // The all-empty guard (isAllAccountsEmpty) fires when EVERY
    // account has 0 txns — so this happy-path test must give the
    // single account at least one real txn. The full all-empty
    // failure path is covered in the dedicated cases below.
    const txn = {
      type: 'Normal',
      date: '2026-01-01T00:00:00.000Z',
      processedDate: '2026-01-01T00:00:00.000Z',
      originalAmount: 100,
      chargedAmount: 100,
      originalCurrency: 'ILS',
      description: '',
      status: 'completed',
    } as unknown as ITransaction;
    const ctx = makeMockContext({
      scrape: some({ accounts: [{ accountNumber: 'A1', balance: 0, txns: [txn] }] }),
    });
    const result = await executeValidateResults(ctx);
    const isOkResult10 = isOk(result);
    expect(isOkResult10).toBe(true);
    if (isOk(result)) {
      expect(result.value.diagnostics.lastAction).toContain('1 accounts');
    }
  });

  it('SCRAPE-ALL-EMPTY-001 — fails when every account has 0 txns (multi-account scrape miss)', async () => {
    // Live evidence: 22 of 25 local host runs on 2026-05-12 reported
    // `[PRE] DIRECT: 0 accts, 0 recs, 0 eps frozen` but the test
    // passed because assertSuccessfulScrape only checks errorType
    // — not transaction counts. When every account has 0 txns it's
    // a silent scrape miss, NOT a real bank state (legitimate state
    // requires at least one account with activity in 180 days).
    const ctx = makeMockContext({
      scrape: some({
        accounts: [
          { accountNumber: 'A1', balance: 0, txns: [] },
          { accountNumber: 'A2', balance: 0, txns: [] },
          { accountNumber: 'A3', balance: 0, txns: [] },
        ],
      }),
    });
    const result = await executeValidateResults(ctx);
    const isResultOk = isOk(result);
    expect(isResultOk).toBe(false);
    if (!isOk(result)) {
      expect(result.errorMessage).toContain('scrape.post: all 3 accounts have 0 txns');
      expect(result.errorMessage).toContain('scrape miss');
    }
  });

  it('SCRAPE-ALL-EMPTY-002 — passes when at least one account has txns (rest may be 0)', async () => {
    // Individual 0-txn accounts are legitimate (dormant cards,
    // newly-issued cards, accounts with no 180-day activity). The
    // guard fires ONLY when EVERY account is empty.
    const txn = {
      type: 'Normal',
      date: '2026-01-01T00:00:00.000Z',
      processedDate: '2026-01-01T00:00:00.000Z',
      originalAmount: 100,
      chargedAmount: 100,
      originalCurrency: 'ILS',
      description: 'real',
      status: 'completed',
    } as unknown as ITransaction;
    const ctx = makeMockContext({
      scrape: some({
        accounts: [
          { accountNumber: 'A1', balance: 0, txns: [] },
          { accountNumber: 'A2', balance: 0, txns: [txn] },
          { accountNumber: 'A3', balance: 0, txns: [] },
        ],
      }),
    });
    const result = await executeValidateResults(ctx);
    const isResultOk = isOk(result);
    expect(isResultOk).toBe(true);
    if (isOk(result)) {
      expect(result.value.diagnostics.lastAction).toContain('3 accounts');
    }
  });

  it('SCRAPE-ALL-EMPTY-003 — single-account-zero-txns also fails (one account is still "all")', async () => {
    // Edge case in the user's rule "bank cannot be all 0 txns":
    // a single account with 0 txns is still "every account empty".
    // Guard catches the single-account case too.
    const ctx = makeMockContext({
      scrape: some({ accounts: [{ accountNumber: 'A1', balance: 0, txns: [] }] }),
    });
    const result = await executeValidateResults(ctx);
    const isResultOk = isOk(result);
    expect(isResultOk).toBe(false);
    if (!isOk(result)) {
      expect(result.errorMessage).toContain('scrape.post: all 1 accounts have 0 txns');
    }
  });

  it('SCRAPE-ALL-EMPTY-004 — zero-accounts case is NOT this guard (different failure mode)', async () => {
    // The "0 accounts at all" case (scrape produced no accounts
    // whatsoever) is a different failure handled elsewhere. This
    // guard is scoped to "have accounts but every one is empty"
    // per debugging-guidlines.md §3 minimal-fix-strategy — do not
    // expand the failure surface beyond the user's reported case.
    const ctx = makeMockContext({
      scrape: some({ accounts: [] }),
    });
    const result = await executeValidateResults(ctx);
    const isResultOk = isOk(result);
    expect(isResultOk).toBe(true);
    if (isOk(result)) {
      expect(result.value.diagnostics.lastAction).toContain('0 accounts');
    }
  });

  it('runs audit when scrapeDiscovery is present', async () => {
    const makeDiscoveryResult11 = makeDiscovery();
    const ctx = makeMockContext({ scrapeDiscovery: some(makeDiscoveryResult11) });
    const result = await executeValidateResults(ctx);
    const isOkResult12 = isOk(result);
    expect(isOkResult12).toBe(true);
  });

  it('warns when every txn has zero amounts', async () => {
    const txn = {
      type: 'Normal',
      date: '2026-01-01T00:00:00.000Z',
      processedDate: '2026-01-01T00:00:00.000Z',
      originalAmount: 0,
      chargedAmount: 0,
      originalCurrency: 'ILS',
      description: '',
      status: 'completed',
    } as unknown as ITransaction;
    const ctx = makeMockContext({
      scrape: some({ accounts: [{ accountNumber: 'A1', balance: 0, txns: [txn] }] }),
    });
    const result = await executeValidateResults(ctx);
    const isOkResult13 = isOk(result);
    expect(isOkResult13).toBe(true);
  });
});

describe('executeStampAccounts', () => {
  it('stamps zero-accounts final marker', async () => {
    const ctx = makeMockContext();
    const result = await executeStampAccounts(ctx);
    const isOkResult14 = isOk(result);
    expect(isOkResult14).toBe(true);
    if (isOk(result)) {
      expect(result.value.diagnostics.lastAction).toContain('scrape-final');
    }
  });

  it('stamps real account count', async () => {
    const ctx = makeMockContext({
      scrape: some({ accounts: [{ accountNumber: 'A1', balance: 0, txns: [] }] }),
    });
    const result = await executeStampAccounts(ctx);
    const isOkResult15 = isOk(result);
    expect(isOkResult15).toBe(true);
    if (isOk(result)) {
      expect(result.value.diagnostics.lastAction).toContain('1 accounts');
    }
  });

  it('carries the captured balance response-body pool onto scrape state', async () => {
    const base = makeMockMediator();
    const pool = makePool([{ BalanceDisplay: 150 }]);
    const network: IElementMediator['network'] = {
      ...base.network,
      /**
       * Return the carried captured pool.
       * @returns The synthetic endpoint pool.
       */
      getAllEndpoints: (): readonly IDiscoveredEndpoint[] => pool,
    };
    const mediator = some<IElementMediator>({ ...base, network });
    const scrape = some({ accounts: [{ accountNumber: 'A1', balance: 0, txns: [] }] });
    const ctx = makeMockContext({ scrape, mediator });
    const result = await executeStampAccounts(ctx);
    const isStampOk = isOk(result);
    expect(isStampOk).toBe(true);
    if (isOk(result) && result.value.scrape.has) {
      expect(result.value.scrape.value.balanceResponseBodies).toEqual([{ BalanceDisplay: 150 }]);
    }
  });
});
