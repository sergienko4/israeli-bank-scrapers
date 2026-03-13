import { jest } from '@jest/globals';

import type { IMoreDetails } from '../../Scrapers/Mizrahi/Interfaces/MoreDetails.js';
import type { IScrapedTransaction } from '../../Scrapers/Mizrahi/Interfaces/ScrapedTransaction.js';

jest.unstable_mockModule('../../Common/Debug.js', () => ({
  getDebug: jest.fn(() => ({
    info: jest.fn(),
    debug: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    trace: jest.fn(),
  })),
  /**
   * Passthrough mock for bank context.
   * @param _b - Bank name (unused).
   * @param fn - Function to execute.
   * @returns fn result.
   */
  runWithBankContext: <T>(_b: string, fn: () => T): T => fn(),
}));

jest.unstable_mockModule('../../Common/ElementsInteractions.js', () => ({
  pageEvalAll: jest.fn(),
}));

const CONVERTERS = await import('../../Scrapers/Mizrahi/MizrahiConverters.js');
const INTERACTIONS = await import('../../Common/ElementsInteractions.js');
const TX = await import('../../Transactions.js');

/** Valid date string in ISO 8601 local-seconds format. */
const VALID_DATE = '2024-06-15T10:30:00';

/**
 * Build a minimal scraped transaction row for testing.
 * @param overrides - fields to override on the base row
 * @returns a scraped transaction stub
 */
function makeRow(overrides: Partial<IScrapedTransaction> = {}): IScrapedTransaction {
  return {
    RecTypeSpecified: true,
    MC02PeulaTaaEZ: VALID_DATE,
    MC02SchumEZ: 100,
    MC02AsmahtaMekoritEZ: '12345',
    MC02TnuaTeurEZ: 'Test purchase',
    IsTodayTransaction: false,
    MC02ErehTaaEZ: '2024-06-15T00:00:00',
    MC02KodGoremEZ: 'A',
    MC02SugTnuaKaspitEZ: '1',
    MC02AgidEZ: '1',
    MC02SeifMaralEZ: '1',
    MC02NoseMaralEZ: '1',
    TransactionNumber: '1',
    ...overrides,
  };
}

/**
 * Stub getMoreDetails returning a memo.
 * @returns details with a test memo
 */
function stubWithMemo(): Promise<IMoreDetails> {
  return Promise.resolve({ entries: { key: 'value' }, memo: 'Test memo' });
}

/**
 * Stub getMoreDetails returning empty data.
 * @returns empty details
 */
function stubEmpty(): Promise<IMoreDetails> {
  return Promise.resolve({ entries: {}, memo: undefined });
}

describe('MizrahiConverters', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('buildRowBase', () => {
    it('returns completed status for non-today row', () => {
      const row = makeRow();
      const result = CONVERTERS.buildRowBase({
        row,
        txnDate: '2024-06-15T10:30:00.000Z',
        moreDetails: { entries: {}, memo: 'memo' },
        isPendingIfTodayTransaction: false,
      });
      expect(result.status).toBe(TX.TransactionStatuses.Completed);
      expect(result.description).toBe('Test purchase');
      expect(result.originalAmount).toBe(100);
      expect(result.memo).toBe('memo');
    });

    it('returns pending when isPendingIfTodayTransaction and IsTodayTransaction', () => {
      const row = makeRow({ IsTodayTransaction: true });
      const result = CONVERTERS.buildRowBase({
        row,
        txnDate: '2024-06-15T10:30:00.000Z',
        moreDetails: { entries: {}, memo: undefined },
        isPendingIfTodayTransaction: true,
      });
      expect(result.status).toBe(TX.TransactionStatuses.Pending);
    });

    it('returns completed when isPendingIfTodayTransaction is false even if today', () => {
      const row = makeRow({ IsTodayTransaction: true });
      const result = CONVERTERS.buildRowBase({
        row,
        txnDate: '2024-06-15T10:30:00.000Z',
        moreDetails: { entries: {}, memo: undefined },
        isPendingIfTodayTransaction: false,
      });
      expect(result.status).toBe(TX.TransactionStatuses.Completed);
    });
  });

  describe('convertOneRow', () => {
    it('converts a valid row with memo', async () => {
      const row = makeRow();
      const result = await CONVERTERS.convertOneRow({
        row,
        getMoreDetails: stubWithMemo,
        isPendingIfTodayTransaction: false,
      });
      expect(result.type).toBe(TX.TransactionTypes.Normal);
      expect(result.originalAmount).toBe(100);
      expect(result.chargedAmount).toBe(100);
      expect(result.memo).toBe('Test memo');
      expect(result.date).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    });

    it('includes rawTransaction when includeRawTransaction is true', async () => {
      const row = makeRow();
      const result = await CONVERTERS.convertOneRow({
        row,
        getMoreDetails: stubWithMemo,
        isPendingIfTodayTransaction: false,
        options: { includeRawTransaction: true } as never,
      });
      expect(result.rawTransaction).toBeDefined();
    });

    it('omits rawTransaction by default', async () => {
      const row = makeRow();
      const result = await CONVERTERS.convertOneRow({
        row,
        getMoreDetails: stubEmpty,
        isPendingIfTodayTransaction: false,
      });
      expect(result.rawTransaction).toBeUndefined();
    });

    it('preserves NaN amount from row', async () => {
      const row = makeRow({ MC02SchumEZ: NaN });
      const result = await CONVERTERS.convertOneRow({
        row,
        getMoreDetails: stubEmpty,
        isPendingIfTodayTransaction: false,
      });
      expect(result.originalAmount).toBeNaN();
      expect(result.chargedAmount).toBeNaN();
    });

    it('handles zero amount', async () => {
      const row = makeRow({ MC02SchumEZ: 0 });
      const result = await CONVERTERS.convertOneRow({
        row,
        getMoreDetails: stubEmpty,
        isPendingIfTodayTransaction: false,
      });
      expect(result.originalAmount).toBe(0);
    });
  });

  describe('convertTransactions', () => {
    it('converts multiple rows', async () => {
      const txns = [makeRow(), makeRow({ MC02SchumEZ: 200 })];
      const results = await CONVERTERS.convertTransactions({
        txns,
        getMoreDetails: stubEmpty,
      });
      expect(results).toHaveLength(2);
      expect(results[0].originalAmount).toBe(100);
      expect(results[1].originalAmount).toBe(200);
    });

    it('returns empty array for no transactions', async () => {
      const results = await CONVERTERS.convertTransactions({
        txns: [],
        getMoreDetails: stubEmpty,
      });
      expect(results).toHaveLength(0);
    });

    it('defaults isPendingIfTodayTransaction to false', async () => {
      const txns = [makeRow({ IsTodayTransaction: true })];
      const results = await CONVERTERS.convertTransactions({
        txns,
        getMoreDetails: stubEmpty,
      });
      expect(results[0].status).toBe(TX.TransactionStatuses.Completed);
    });
  });

  describe('mapPendingRow', () => {
    it('maps a valid row with comma-separated amount', () => {
      const row = ['15/06/24', 'Coffee shop', 'ref-123', '1,234.50'];
      const result = CONVERTERS.mapPendingRow(row);
      const hasEmpty = 'isEmpty' in result;
      expect(hasEmpty).toBe(false);
      const txn = result as { originalAmount: number; description: string; status: string };
      expect(txn.originalAmount).toBe(1234.5);
      expect(txn.description).toBe('Coffee shop');
      expect(txn.status).toBe(TX.TransactionStatuses.Pending);
    });

    it('returns empty marker for invalid date string', () => {
      const row = ['not-a-date', 'desc', 'ref', '100'];
      const result = CONVERTERS.mapPendingRow(row);
      const hasEmpty = 'isEmpty' in result;
      expect(hasEmpty).toBe(true);
    });

    it('handles negative amount', () => {
      const row = ['15/06/24', 'Refund', 'ref', '-50.00'];
      const result = CONVERTERS.mapPendingRow(row);
      const hasEmpty = 'isEmpty' in result;
      expect(hasEmpty).toBe(false);
      const txn = result as { originalAmount: number };
      expect(txn.originalAmount).toBe(-50);
    });

    it('handles plain numeric amount', () => {
      const row = ['01/01/24', 'Shop', 'r', '99.99'];
      const result = CONVERTERS.mapPendingRow(row);
      const hasEmpty = 'isEmpty' in result;
      expect(hasEmpty).toBe(false);
      const txn = result as { originalAmount: number };
      expect(txn.originalAmount).toBeCloseTo(99.99);
    });
  });

  describe('extractPendingTxns', () => {
    it('returns valid transactions from page eval', async () => {
      const mockEvalAll = INTERACTIONS.pageEvalAll as jest.MockedFunction<
        typeof INTERACTIONS.pageEvalAll
      >;
      mockEvalAll.mockResolvedValue([
        ['15/06/24', 'Purchase', 'ref', '100'],
        ['16/06/24', 'Another', 'ref2', '200'],
      ]);
      const fakePage = {} as never;
      const results = await CONVERTERS.extractPendingTxns(fakePage);
      expect(results).toHaveLength(2);
      expect(results[0].description).toBe('Purchase');
      expect(results[1].originalAmount).toBe(200);
    });

    it('filters out empty/invalid rows', async () => {
      const mockEvalAll = INTERACTIONS.pageEvalAll as jest.MockedFunction<
        typeof INTERACTIONS.pageEvalAll
      >;
      mockEvalAll.mockResolvedValue([
        ['15/06/24', 'Valid', 'ref', '50'],
        ['invalid', 'Bad row', 'ref', '100'],
      ]);
      const fakePage = {} as never;
      const results = await CONVERTERS.extractPendingTxns(fakePage);
      expect(results).toHaveLength(1);
      expect(results[0].description).toBe('Valid');
    });

    it('returns empty array when no rows', async () => {
      const mockEvalAll = INTERACTIONS.pageEvalAll as jest.MockedFunction<
        typeof INTERACTIONS.pageEvalAll
      >;
      mockEvalAll.mockResolvedValue([]);
      const fakePage = {} as never;
      const results = await CONVERTERS.extractPendingTxns(fakePage);
      expect(results).toHaveLength(0);
    });
  });
});
