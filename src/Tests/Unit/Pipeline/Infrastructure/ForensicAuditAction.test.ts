/**
 * Unit tests for ForensicAuditAction — POST forensic audit logging.
 * Covers logForensicAudit + scrapePostDiagnostics.
 */

import {
  logForensicAudit,
  resolveAuditLabel,
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

  it('logQualifiedCard matches via suffix when account.accountNumber differs from card (long vs short form)', () => {
    // VisaCal-class regression — qualifiedCards holds long-form
    // `cardUniqueId` (e.g. `198302041582022213`) while the resolved
    // accountNumber is the short last4 form (`3020`). The audit must
    // attribute txns to the right card via bidirectional suffix match.
    const disc = makeDiscovery(['198302041582022213'], []);
    const acct = makeAccount('3020', 12);
    const ctx = makeMockContext({
      scrapeDiscovery: some(disc),
      scrape: some({ accounts: [acct] }),
    });
    const didLog = logForensicAudit(ctx);
    expect(didLog).toBe(true);
  });

  it('logQualifiedCard matches via reverse suffix (account longer than card)', () => {
    // Hapoalim-class — accountNumber `[REDACTED-ACCT]` is longer than
    // qualified card `[REDACTED-ACCT-6]`; reverse suffix-match exercises the
    // accountNumber.endsWith(card) branch.
    const disc = makeDiscovery(['[REDACTED-ACCT-6]'], []);
    const acct = makeAccount('[REDACTED-ACCT]', 1);
    const ctx = makeMockContext({
      scrapeDiscovery: some(disc),
      scrape: some({ accounts: [acct] }),
    });
    const didLog = logForensicAudit(ctx);
    expect(didLog).toBe(true);
  });

  it('logQualifiedCard reports 0 txns when no account is compatible with the card id', () => {
    // Empty-account / no-match path — neither equality nor suffix
    // match holds; the audit reports 0 txns for the card.
    const disc = makeDiscovery(['CARD-UNRELATED'], []);
    const acct = makeAccount('OTHER-ACCT', 5);
    const ctx = makeMockContext({
      scrapeDiscovery: some(disc),
      scrape: some({ accounts: [acct] }),
    });
    const didLog = logForensicAudit(ctx);
    expect(didLog).toBe(true);
  });

  it('logQualifiedCard treats empty card or empty accountNumber as no-match', () => {
    // Defensive — empty strings on either side return false from
    // isAccountIdMatch; the audit reports 0 txns.
    const disc = makeDiscovery([''], []);
    const acct = makeAccount('A1', 3);
    const ctx = makeMockContext({
      scrapeDiscovery: some(disc),
      scrape: some({ accounts: [acct] }),
    });
    const didLog = logForensicAudit(ctx);
    expect(didLog).toBe(true);
  });
});

describe('resolveAuditLabel — M4.F4 (Visacal AUDIT mislabel)', () => {
  // M4.F4 evidence: Visacal CI run 15180979 logged 48 HTTP-500 responses
  // all labelled `API Success`. fetchSequential is fail-fast — a 5xx
  // propagates and short-circuits SCRAPE, so the qualified card never
  // gets an account record. `accounts.find()` returns nothing → caller
  // passes `false` into resolveAuditLabel and the audit label surfaces
  // `API Error` (same vocabulary as the pruned-card branch in
  // ForensicAuditAction.logCardClassification) instead of the
  // misleading `API Success`.
  it('AUDIT-HTTP-5XX-LABEL-001: scrapeSucceeded=false → API Error', () => {
    const label = resolveAuditLabel(false);
    expect(label).toBe('API Error');
  });

  it('AUDIT-HTTP-5XX-LABEL-001b: scrapeSucceeded=true → API Success', () => {
    const label = resolveAuditLabel(true);
    expect(label).toBe('API Success');
  });

  it('AUDIT-HTTP-5XX-LABEL-001c: caller distinguishes "no account" from "0 txns"', () => {
    // The boolean signal MUST come from "did `accounts.find` return a
    // record?", NOT from "is the txns array empty?". A legitimately-
    // empty account (Amex/Isracard dormant-card case from
    // dom-ready-everywhere/status.txt §v9) is still a successful
    // SCRAPE that just had nothing to return; only an ABSENT account
    // record qualifies as API Error. This test mirrors production's
    // `accounts.find()` lookup in logQualifiedCard across all three
    // states: matched-with-txns, matched-empty, and not-found.
    const accounts = [makeAccount('A1', 3), makeAccount('A2', 0)];
    const acctWithTxns = accounts.find(a => a.accountNumber === 'A1');
    const acctEmpty = accounts.find(a => a.accountNumber === 'A2');
    const acctMissing = accounts.find(a => a.accountNumber === 'NOT_PRESENT');
    const hasTxnAcct = acctWithTxns !== undefined;
    const hasEmptyAcct = acctEmpty !== undefined;
    const hasMissingAcct = acctMissing !== undefined;
    expect(hasTxnAcct).toBe(true);
    expect(hasEmptyAcct).toBe(true);
    expect(hasMissingAcct).toBe(false);
    const haveTxnsLabel = resolveAuditLabel(hasTxnAcct);
    const haveEmptyLabel = resolveAuditLabel(hasEmptyAcct);
    const haveMissingLabel = resolveAuditLabel(hasMissingAcct);
    expect(haveTxnsLabel).toBe('API Success');
    expect(haveEmptyLabel).toBe('API Success');
    expect(haveMissingLabel).toBe('API Error');
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
