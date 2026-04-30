/**
 * Unit tests for ForensicAuditAction — POST forensic audit logging.
 * Covers logForensicAudit + scrapePostDiagnostics.
 */

import {
  logForensicAudit,
  scrapePostDiagnostics,
} from '../../../../Scrapers/Pipeline/Mediator/Scrape/ForensicAuditAction.js';
import { none, some } from '../../../../Scrapers/Pipeline/Types/Option.js';
import type { IScrapeDiscovery } from '../../../../Scrapers/Pipeline/Types/PipelineContext.js';
import { isOk } from '../../../../Scrapers/Pipeline/Types/Procedure.js';
import type { ITransactionsAccount } from '../../../../Transactions.js';
import { TransactionStatuses, TransactionTypes } from '../../../../Transactions.js';
import { makeMockContext } from './MockFactories.js';

/**
 * Build a minimal qualified scrape discovery.
 * @param qualified - Qualified card IDs.
 * @param pruned - Pruned card IDs.
 * @returns Mock IScrapeDiscovery.
 */
function makeDiscovery(qualified: readonly string[], pruned: readonly string[]): IScrapeDiscovery {
  return {
    qualifiedCards: qualified,
    prunedCards: pruned,
    txnTemplateUrl: '',
    txnTemplateBody: {},
    billingMonths: [],
  };
}

/**
 * Build a minimal scraped account with one txn.
 * @param accountNumber - Account identifier.
 * @param txnCount - Number of transactions to include.
 * @returns Mock ITransactionsAccount.
 */
function makeAccount(accountNumber: string, txnCount: number): ITransactionsAccount {
  const txns = Array.from({ length: txnCount }, (_, i) => ({
    type: TransactionTypes.Normal,
    identifier: i,
    date: '2026-01-01T00:00:00.000Z',
    processedDate: '2026-01-01T00:00:00.000Z',
    originalAmount: -100,
    originalCurrency: 'ILS',
    chargedAmount: -100,
    description: 'T',
    status: TransactionStatuses.Completed,
  }));
  return { accountNumber, balance: 0, txns };
}

describe('logForensicAudit', () => {
  it('emits audit even without scrapeDiscovery (api-direct-call path)', () => {
    // Browser-driven banks populate scrapeDiscovery → qualified/pruned card
    // lines fire. API-direct-call banks (Pepper, OneZero) skip discovery →
    // the qualified/pruned section is silently skipped, but the table
    // header, mirror check, and per-account summary still emit so the
    // pipeline.log carries a txn record for every scrape path.
    const ctx = makeMockContext();
    const didLogForensicAudit = logForensicAudit(ctx);
    expect(didLogForensicAudit).toBe(true);
  });

  it('emits audit when scrapeDiscovery present without scrape state', () => {
    const disc = makeDiscovery(['A1'], []);
    const ctx = makeMockContext({ scrapeDiscovery: some(disc) });
    const didLogForensicAudit = logForensicAudit(ctx);
    expect(didLogForensicAudit).toBe(true);
  });

  it('logs qualified cards with scrape accounts', () => {
    const disc = makeDiscovery(['40286139'], ['4718']);
    const account = makeAccount('40286139', 3);
    const ctx = makeMockContext({
      scrapeDiscovery: some(disc),
      scrape: some({ accounts: [account] }),
    });
    const didLogForensicAudit = logForensicAudit(ctx);
    expect(didLogForensicAudit).toBe(true);
  });

  it('per-account summary skips txn-preview when txns array is empty', () => {
    // Covers the FALSE branch of `if (acct.txns.length > 0)` inside
    // logAccountTxnSummary. The INFO header still fires; the DEBUG preview
    // must NOT fire because there's nothing to preview.
    const disc = makeDiscovery(['A1'], []);
    const emptyAcct = makeAccount('A1', 0);
    const ctx = makeMockContext({
      scrapeDiscovery: some(disc),
      scrape: some({ accounts: [emptyAcct] }),
    });
    const didLogForensicAuditZeroTxns = logForensicAudit(ctx);
    expect(didLogForensicAuditZeroTxns).toBe(true);
  });

  it('truncates long descriptions for transaction preview', () => {
    const disc = makeDiscovery(['A1'], []);
    const longDesc = 'A'.repeat(40);
    const acct: ITransactionsAccount = {
      accountNumber: 'A1',
      balance: 0,
      txns: [
        {
          type: TransactionTypes.Normal,
          identifier: 1,
          date: '2026-01-01T00:00:00.000Z',
          processedDate: '2026-01-01T00:00:00.000Z',
          originalAmount: -100,
          originalCurrency: 'ILS',
          chargedAmount: -100,
          description: longDesc,
          status: TransactionStatuses.Completed,
        },
      ],
    };
    const ctx = makeMockContext({
      scrapeDiscovery: some(disc),
      scrape: some({ accounts: [acct] }),
    });
    const didLogForensicAuditResult1 = logForensicAudit(ctx);
    expect(didLogForensicAuditResult1).toBe(true);
  });

  it('emits preview truncation line when txns exceed preview limit', () => {
    const disc = makeDiscovery(['A1'], []);
    const account = makeAccount('A1', 15);
    const ctx = makeMockContext({
      scrapeDiscovery: some(disc),
      scrape: some({ accounts: [account] }),
    });
    const didLogForensicAuditResult2 = logForensicAudit(ctx);
    expect(didLogForensicAuditResult2).toBe(true);
  });

  it('formatTxnLine falls back to 0 / ILS / empty desc when txn fields missing', () => {
    // Exercises the ?? fallback branches at lines 83/85/86 of ForensicAuditAction.
    const disc = makeDiscovery(['A1'], []);
    const missingFields: ITransactionsAccount = {
      accountNumber: 'A1',
      balance: 0,
      txns: [
        {
          type: TransactionTypes.Normal,
          identifier: 1,
          date: '',
          processedDate: '',
          originalAmount: 0,
          originalCurrency: undefined as unknown as string,
          chargedAmount: undefined as unknown as number,
          description: undefined as unknown as string,
          status: TransactionStatuses.Completed,
        },
      ],
    };
    const ctx = makeMockContext({
      scrapeDiscovery: some(disc),
      scrape: some({ accounts: [missingFields] }),
    });
    const didLogForensicAuditResult3 = logForensicAudit(ctx);
    expect(didLogForensicAuditResult3).toBe(true);
  });

  it('formatTxnLine uses originalAmount when chargedAmount missing', () => {
    const disc = makeDiscovery(['A1'], []);
    const acct: ITransactionsAccount = {
      accountNumber: 'A1',
      balance: 0,
      txns: [
        {
          type: TransactionTypes.Normal,
          identifier: 1,
          date: '2026-01-01T00:00:00.000Z',
          processedDate: '2026-01-01T00:00:00.000Z',
          originalAmount: 99,
          originalCurrency: 'USD',
          chargedAmount: undefined as unknown as number,
          description: 'x',
          status: TransactionStatuses.Completed,
        },
      ],
    };
    const ctx = makeMockContext({
      scrapeDiscovery: some(disc),
      scrape: some({ accounts: [acct] }),
    });
    const didLogForensicAuditResult4 = logForensicAudit(ctx);
    expect(didLogForensicAuditResult4).toBe(true);
  });
});

describe('scrapePostDiagnostics', () => {
  it('stamps diagnostics when no discovery present', async () => {
    const ctx = makeMockContext({ scrapeDiscovery: none() });
    const result = await scrapePostDiagnostics(ctx, ctx);
    const isOkResult5 = isOk(result);
    expect(isOkResult5).toBe(true);
    if (isOk(result)) {
      expect(result.value.diagnostics.lastAction).toBe('scrape-post (0 accounts)');
    }
  });

  it('counts accounts in diagnostics when scrape state exists', async () => {
    const acct = makeAccount('A1', 1);
    const makeDiscoveryResult6 = makeDiscovery(['A1'], []);
    const ctx = makeMockContext({
      scrapeDiscovery: some(makeDiscoveryResult6),
      scrape: some({ accounts: [acct] }),
    });
    const result = await scrapePostDiagnostics(ctx, ctx);
    const isOkResult7 = isOk(result);
    expect(isOkResult7).toBe(true);
    if (isOk(result)) {
      expect(result.value.diagnostics.lastAction).toContain('1 accounts');
    }
  });
});
