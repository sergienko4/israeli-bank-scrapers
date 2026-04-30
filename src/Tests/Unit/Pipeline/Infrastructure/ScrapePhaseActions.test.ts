/**
 * Unit tests for ScrapePhaseActions — PRE/ACTION/POST/FINAL orchestration.
 */

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
import { makeMockContext } from '../../Scrapers/Pipeline/MockPipelineFactories.js';
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

  it('runs PROXY path when strategy=PROXY', async () => {
    const base = makeMockContext();
    const ctx = {
      ...base,
      diagnostics: { ...base.diagnostics, apiStrategy: API_STRATEGY.PROXY },
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

  it('stamps accounts count when scrape state has accounts', async () => {
    const ctx = makeMockContext({
      scrape: some({ accounts: [{ accountNumber: 'A1', balance: 0, txns: [] }] }),
    });
    const result = await executeValidateResults(ctx);
    const isOkResult10 = isOk(result);
    expect(isOkResult10).toBe(true);
    if (isOk(result)) {
      expect(result.value.diagnostics.lastAction).toContain('1 accounts');
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
});
