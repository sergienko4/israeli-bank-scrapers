/**
 * Unit tests for ForensicAuditAction — POST forensic audit logging.
 * Covers logForensicAudit + logWindowCompleteness.
 */

import logForensicAudit from '../../../../Scrapers/Pipeline/Mediator/Scrape/ForensicAuditAction.js';
import { logWindowCompleteness } from '../../../../Scrapers/Pipeline/Mediator/Scrape/WindowCompletenessAudit.js';
import type { IScrapeState } from '../../../../Scrapers/Pipeline/Types/Domain/ScrapeState.js';
import { some } from '../../../../Scrapers/Pipeline/Types/Option.js';
import type { ITransactionsAccount } from '../../../../Transactions.js';
import { TransactionStatuses, TransactionTypes } from '../../../../Transactions.js';
import { makeMockContext } from './MockFactories.js';

/**
 * Build a minimal scraped account with identical txns.
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

/**
 * Build an account whose single txn omits every optional audit field.
 * @returns Account exercising the formatter's fallback branches.
 */
function makeAccountMissingFields(): ITransactionsAccount {
  const txn = {
    type: TransactionTypes.Normal,
    identifier: 1,
    date: '',
    processedDate: '',
    originalAmount: 0,
    originalCurrency: undefined as unknown as string,
    chargedAmount: undefined as unknown as number,
    description: undefined as unknown as string,
    status: TransactionStatuses.Completed,
  };
  return { accountNumber: 'A1', balance: 0, txns: [txn] };
}

/**
 * Build an account whose single txn carries only an original amount.
 * @returns Account exercising the originalAmount fallback.
 */
function makeAccountOriginalOnly(): ITransactionsAccount {
  const txn = {
    type: TransactionTypes.Normal,
    identifier: 1,
    date: '2026-01-01T00:00:00.000Z',
    processedDate: '2026-01-01T00:00:00.000Z',
    originalAmount: 99,
    originalCurrency: 'USD',
    chargedAmount: undefined as unknown as number,
    description: 'x',
    status: TransactionStatuses.Completed,
  };
  return { accountNumber: 'A1', balance: 0, txns: [txn] };
}

/**
 * Build a scrape state carrying only the completeness flag under test.
 * @param isExhausted - Whether backfill was spent without covering the window.
 * @returns Scrape state with no accounts and the given flag.
 */
function makeScrapeState(isExhausted: boolean): IScrapeState {
  return { accounts: [], backfillExhausted: isExhausted };
}

describe('logWindowCompleteness', () => {
  it('records NOT_EXHAUSTED when backfill was not exhausted', () => {
    const scrape = makeScrapeState(false);
    const verdict = logWindowCompleteness(scrape);
    expect(verdict).toBe('NOT_EXHAUSTED');
  });

  it('records EXHAUSTED when backfill was spent short of the window', () => {
    const scrape = makeScrapeState(true);
    const verdict = logWindowCompleteness(scrape);
    expect(verdict).toBe('EXHAUSTED');
  });

  it('treats an absent flag as no shortfall, never as a shortfall', () => {
    // A shape that never reports the flag must read as "no shortfall
    // observed", not as an unproven shortfall, or every such bank would
    // warn on every run.
    const scrape = { accounts: [] } as IScrapeState;
    const verdict = logWindowCompleteness(scrape);
    expect(verdict).toBe('NOT_EXHAUSTED');
  });

  it('never claims coverage, because one flag cannot prove it', () => {
    // The never-asked and the asked-and-succeeded runs leave the flag clear
    // for different reasons and are indistinguishable here. Actual coverage
    // is read from the per-account WINDOW lines — see
    // docs/observability/coverage-audit.md.
    const scrape = makeScrapeState(false);
    const verdict = logWindowCompleteness(scrape);
    expect(verdict).not.toBe('COVERED');
  });
});

describe('logForensicAudit', () => {
  it('emits audit when no scrape state is present', () => {
    const ctx = makeMockContext();
    const didLogForensicAudit = logForensicAudit(ctx);
    expect(didLogForensicAudit).toBe(true);
  });

  it('logs one summary per scraped account', () => {
    const account = makeAccount('40286139', 3);
    const ctx = makeMockContext({ scrape: some({ accounts: [account] }) });
    const didLogForensicAudit = logForensicAudit(ctx);
    expect(didLogForensicAudit).toBe(true);
  });

  it('per-account summary skips txn-preview when txns array is empty', () => {
    // Covers the FALSE branch of `if (acct.txns.length > 0)` inside
    // logAccountTxnSummary. The INFO header still fires; the DEBUG preview
    // must NOT fire because there's nothing to preview.
    const emptyAcct = makeAccount('A1', 0);
    const ctx = makeMockContext({ scrape: some({ accounts: [emptyAcct] }) });
    const didLogForensicAuditZeroTxns = logForensicAudit(ctx);
    expect(didLogForensicAuditZeroTxns).toBe(true);
  });

  it('formats txn preview lines for a long account', () => {
    const account = makeAccount('A1', 15);
    const ctx = makeMockContext({ scrape: some({ accounts: [account] }) });
    const didLogForensicAudit = logForensicAudit(ctx);
    expect(didLogForensicAudit).toBe(true);
  });

  it('formatTxnLine falls back to 0 / ILS / empty desc when txn fields missing', () => {
    const account = makeAccountMissingFields();
    const ctx = makeMockContext({ scrape: some({ accounts: [account] }) });
    const didLogForensicAudit = logForensicAudit(ctx);
    expect(didLogForensicAudit).toBe(true);
  });

  it('formatTxnLine uses originalAmount when chargedAmount missing', () => {
    const account = makeAccountOriginalOnly();
    const ctx = makeMockContext({ scrape: some({ accounts: [account] }) });
    const didLogForensicAudit = logForensicAudit(ctx);
    expect(didLogForensicAudit).toBe(true);
  });
});
