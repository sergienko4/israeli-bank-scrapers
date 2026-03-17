/**
 * Branch coverage tests for LeumiTransactions.ts.
 * Targets: buildTxnsFromResponse, parseAccountResponse, extractGroup,
 * hasRequiredFields, buildTxnBase optional fields.
 */
import {
  buildTxnsFromResponse,
  type ILeumiAccountResponse,
  type ILeumiRawTransaction,
  parseAccountResponse,
} from '../../Scrapers/Leumi/LeumiTransactions.js';
import { TransactionStatuses, TransactionTypes } from '../../Transactions.js';

/**
 * Build a raw Leumi transaction with defaults.
 * @param overrides - partial fields to merge.
 * @returns complete raw transaction.
 */
function makeRawTxn(overrides: Partial<ILeumiRawTransaction> = {}): ILeumiRawTransaction {
  return {
    DateUTC: '2025-06-15T00:00:00',
    Amount: -100,
    Description: 'Test Transaction',
    ReferenceNumberLong: 12345,
    AdditionalData: 'memo',
    ...overrides,
  };
}

describe('buildTxnsFromResponse', () => {
  const defaultOptions = { companyId: 'leumi', startDate: new Date('2024-01-01') } as never;

  it('returns empty array when both groups are null', () => {
    const response: ILeumiAccountResponse = {
      TodayTransactionsItems: null,
      HistoryTransactionsItems: null,
    };
    const txns = buildTxnsFromResponse(response, defaultOptions);
    expect(txns).toHaveLength(0);
  });

  it('returns pending transactions from TodayTransactionsItems', () => {
    const response: ILeumiAccountResponse = {
      TodayTransactionsItems: [makeRawTxn()],
      HistoryTransactionsItems: null,
    };
    const txns = buildTxnsFromResponse(response, defaultOptions);
    expect(txns).toHaveLength(1);
    expect(txns[0].status).toBe(TransactionStatuses.Pending);
  });

  it('returns completed transactions from HistoryTransactionsItems', () => {
    const response: ILeumiAccountResponse = {
      TodayTransactionsItems: null,
      HistoryTransactionsItems: [makeRawTxn()],
    };
    const txns = buildTxnsFromResponse(response, defaultOptions);
    expect(txns).toHaveLength(1);
    expect(txns[0].status).toBe(TransactionStatuses.Completed);
  });

  it('handles missing Description and AdditionalData', () => {
    const response: ILeumiAccountResponse = {
      TodayTransactionsItems: null,
      HistoryTransactionsItems: [makeRawTxn({ Description: undefined, AdditionalData: undefined })],
    };
    const txns = buildTxnsFromResponse(response, defaultOptions);
    expect(txns[0].description).toBe('');
    expect(txns[0].memo).toBe('');
  });

  it('handles empty arrays in both groups', () => {
    const response: ILeumiAccountResponse = {
      TodayTransactionsItems: [],
      HistoryTransactionsItems: [],
    };
    const txns = buildTxnsFromResponse(response, defaultOptions);
    expect(txns).toHaveLength(0);
  });

  it('includes rawTransaction when option set', () => {
    const response: ILeumiAccountResponse = {
      TodayTransactionsItems: null,
      HistoryTransactionsItems: [makeRawTxn()],
    };
    const opts = {
      companyId: 'leumi',
      startDate: new Date('2024-01-01'),
      includeRawTransaction: true,
    } as never;
    const txns = buildTxnsFromResponse(response, opts);
    expect(txns[0].rawTransaction).toBeDefined();
  });

  it('sets type to Normal for all transactions', () => {
    const response: ILeumiAccountResponse = {
      TodayTransactionsItems: [makeRawTxn()],
      HistoryTransactionsItems: [makeRawTxn()],
    };
    const txns = buildTxnsFromResponse(response, defaultOptions);
    for (const txn of txns) {
      expect(txn.type).toBe(TransactionTypes.Normal);
    }
  });
});

describe('parseAccountResponse', () => {
  it('parses valid JSON response', () => {
    const jsonResp = JSON.stringify({
      TodayTransactionsItems: [],
      HistoryTransactionsItems: [],
    });
    const result = parseAccountResponse({ jsonResp });
    expect(result.TodayTransactionsItems).toEqual([]);
    expect(result.HistoryTransactionsItems).toEqual([]);
  });

  it('throws on invalid JSON', () => {
    expect(() => parseAccountResponse({ jsonResp: 'not json' })).toThrow(
      'Failed to parse Leumi response',
    );
  });

  it('throws when TodayTransactionsItems is not array or null', () => {
    const jsonResp = JSON.stringify({
      TodayTransactionsItems: 'invalid',
      HistoryTransactionsItems: [],
    });
    expect(() => parseAccountResponse({ jsonResp })).toThrow('Unexpected Leumi response shape');
  });

  it('throws when HistoryTransactionsItems is not array or null', () => {
    const jsonResp = JSON.stringify({
      TodayTransactionsItems: null,
      HistoryTransactionsItems: 'invalid',
    });
    expect(() => parseAccountResponse({ jsonResp })).toThrow('Unexpected Leumi response shape');
  });

  it('accepts null values for transaction lists', () => {
    const jsonResp = JSON.stringify({
      TodayTransactionsItems: null,
      HistoryTransactionsItems: null,
    });
    const result = parseAccountResponse({ jsonResp });
    expect(result.TodayTransactionsItems).toBeNull();
    expect(result.HistoryTransactionsItems).toBeNull();
  });

  it('preserves BalanceDisplay from response', () => {
    const jsonResp = JSON.stringify({
      TodayTransactionsItems: null,
      HistoryTransactionsItems: null,
      BalanceDisplay: '5000.50',
    });
    const result = parseAccountResponse({ jsonResp });
    expect(result.BalanceDisplay).toBe('5000.50');
  });
});
