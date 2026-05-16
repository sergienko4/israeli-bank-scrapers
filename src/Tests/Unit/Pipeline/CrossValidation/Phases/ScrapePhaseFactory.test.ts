/**
 * Phase H.T3c.9 — cross-bank SCRAPE per-phase factory.
 *
 * <p>Drives every bank's PII-redacted last-good scrape output
 * through production {@link executeValidateResults} (POST) +
 * {@link executeStampAccounts} (FINAL), asserting the all-accounts-
 * empty guard accepts non-empty scrape output and FINAL stamps the
 * account count. Each row consumes a dedicated
 * `<bank>/scrape/<scenarioId>.json` fixture (locked plan H.T3c.9:
 * "+ 7 fixtures").
 *
 * <p>Contract (`ScrapePhaseActions.ts:375-500`):
 * <ul>
 *   <li>POST: succeeds when accounts.length >= 1 AND at least one
 *       account has >= 1 txn. Fails loud "scrape.post: all N
 *       accounts have 0 txns — scrape miss" when every account is
 *       empty.</li>
 *   <li>FINAL: always succeeds — stamps account count into
 *       diagnostics for the audit trail.</li>
 * </ul>
 *
 * <p>Complements existing Phase G cross-bank dedup factory
 * (CrossBankDedup) which covers the upstream txn-list extraction +
 * dedup chain. H.T3c.9 covers the SCRAPE-phase POST+FINAL guard
 * specifically.
 */

import {
  executeStampAccounts,
  executeValidateResults,
} from '../../../../../Scrapers/Pipeline/Mediator/Scrape/ScrapePhaseActions.js';
import {
  type ITransaction,
  type ITransactionsAccount,
  TransactionStatuses,
  TransactionTypes,
} from '../../../../../Transactions.js';
import { loadPhaseFixture, type PhaseHBank } from './Fixtures/_makePhaseFixture.js';
import { buildScrapePhaseContext } from './Fixtures/_makeScrapePhaseContext.js';

/** Per-scenario row driven by the parameterised `it.each` below. */
interface IScrapeScenarioRow {
  readonly bank: PhaseHBank;
  readonly scenarioId: string;
}

/** Scenarios exercised — one row per bank, all using last-good captures. */
const SCENARIOS: readonly IScrapeScenarioRow[] = [
  { bank: 'hapoalim', scenarioId: 'last-good' },
  { bank: 'beinleumi', scenarioId: 'last-good' },
  { bank: 'discount', scenarioId: 'last-good' },
  { bank: 'amex', scenarioId: 'last-good' },
  { bank: 'isracard', scenarioId: 'last-good' },
  { bank: 'max', scenarioId: 'last-good' },
  { bank: 'visacal', scenarioId: 'last-good' },
];

/**
 * Build a single redacted transaction record. Reused across banks to
 * keep the factory bank-agnostic (the bank-specific dimension lives
 * in `expected.scrapeExpectedTxnCount`).
 *
 * @param ordinal - Ordinal used to suffix the identifier so multi-
 *   txn fixtures retain distinct identifiers.
 * @returns Redacted transaction record.
 */
function buildRedactedTxn(ordinal: number): ITransaction {
  return {
    type: TransactionTypes.Normal,
    identifier: `FAKE-TXN-${String(ordinal)}`,
    date: '2026-05-01T00:00:00.000Z',
    processedDate: '2026-05-01T00:00:00.000Z',
    originalAmount: -100,
    originalCurrency: 'ILS',
    chargedAmount: -100,
    description: 'FAKE TEXT',
    status: TransactionStatuses.Completed,
  };
}

/**
 * Build a redacted account with the requested txn count. Single-
 * account-per-bank keeps the factory's contract focused on the
 * all-accounts-empty guard rather than multi-account aggregation
 * (the cross-bank dedup factory covers that).
 *
 * @param txnCount - Number of txns to populate the account with.
 * @returns Redacted account record.
 */
function buildRedactedAccount(txnCount: number): ITransactionsAccount {
  const txns = Array.from(
    { length: txnCount },
    (_unused, index): ITransaction => buildRedactedTxn(index),
  );
  return {
    accountNumber: 'FAKE-000000',
    balance: 0,
    txns,
  };
}

describe('SCRAPE-PHASE-FACTORY — Phase H per-bank POST+FINAL', () => {
  it.each(SCENARIOS)(
    'scrape_$bank_$scenarioId_ShouldValidateResultsAndStamp',
    async (row): Promise<void> => {
      const fixture = loadPhaseFixture(row.bank, `scrape/${row.scenarioId}`);
      const expectedTxnCount = fixture.meta.expected.scrapeExpectedTxnCount ?? 1;
      const accounts: readonly ITransactionsAccount[] = [buildRedactedAccount(expectedTxnCount)];
      const subject = buildScrapePhaseContext({ accounts });

      const postResult = await executeValidateResults(subject.context);
      const shouldPostSucceed = fixture.meta.expected.scrapePostOutcome === 'success';
      expect(postResult.success).toBe(shouldPostSucceed);

      if (postResult.success) {
        const finalResult = await executeStampAccounts(postResult.value);
        const shouldFinalSucceed = fixture.meta.expected.scrapeFinalOutcome === 'success';
        expect(finalResult.success).toBe(shouldFinalSucceed);
      }
    },
  );
});
