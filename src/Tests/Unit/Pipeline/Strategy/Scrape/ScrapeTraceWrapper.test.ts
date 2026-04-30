/**
 * Unit tests for Strategy/Scrape/ScrapeTraceWrapper — withTrace wrapper.
 */

import { withTrace } from '../../../../../Scrapers/Pipeline/Strategy/Scrape/ScrapeTraceWrapper.js';
import type { ITransaction } from '../../../../../Transactions.js';
import { TransactionStatuses, TransactionTypes } from '../../../../../Transactions.js';

/**
 * Build a single stub transaction.
 * @returns Transaction.
 */
function makeTxn(): ITransaction {
  return {
    type: TransactionTypes.Normal,
    date: '2026-01-01',
    processedDate: '2026-01-01',
    originalAmount: -100,
    originalCurrency: 'ILS',
    chargedAmount: -100,
    description: 'shop',
    status: TransactionStatuses.Completed,
    identifier: 'id-1',
  };
}

describe('withTrace', () => {
  it('returns transactions from inner fn', async () => {
    const txn = makeTxn();
    const result = await withTrace('card-1', '01/2026', () => Promise.resolve([txn]));
    expect(result).toEqual([txn]);
  });

  it('handles empty-result path (status=empty)', async () => {
    const result = await withTrace('card-1', '01/2026', () => Promise.resolve([]));
    expect(result).toEqual([]);
  });

  it('re-throws inner error', async () => {
    const err = new Error('inner fail');
    const call = withTrace('card-1', '01/2026', async () => {
      await Promise.resolve();
      throw err;
    });
    await expect(call).rejects.toThrow('inner fail');
  });
});
