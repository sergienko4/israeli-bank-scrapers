/**
 * Branch coverage tests for MizrahiConverters.ts.
 * Targets: buildRowBase isPendingIfTodayTransaction branch,
 * convertOneRow includeRawTransaction, mapPendingRow empty date,
 * convertTransactions default isPendingIfTodayTransaction.
 */
import { jest } from '@jest/globals';

jest.unstable_mockModule('../../Common/Debug.js', () => ({
  /**
   * Creates a mock debug logger.
   * @returns mock debug logger.
   */
  getDebug: (): Record<string, jest.Mock> => ({
    trace: jest.fn(),
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  }),
  /**
   * Passthrough mock for bank context.
   * @param _b - Bank name (unused).
   * @param fn - Function to execute.
   * @returns fn result.
   */
  runWithBankContext: <T>(_b: string, fn: () => T): T => fn(),
}));

jest.unstable_mockModule('../../Common/Transactions.js', () => ({
  getRawTransaction: jest.fn((data: Record<string, string>) => data),
}));

jest.unstable_mockModule('../../Common/Waiting.js', () => ({
  sleep: jest.fn().mockResolvedValue(undefined),
  humanDelay: jest.fn().mockResolvedValue(undefined),
  waitUntil: jest.fn().mockResolvedValue(undefined),
  runSerial: jest.fn().mockResolvedValue([]),
  TimeoutError: class TimeoutError extends Error {},
  SECOND: 1000,
}));

const MOD = await import('../../Scrapers/Mizrahi/MizrahiConverters.js');
const { TransactionStatuses: TXN_STATUSES } = await import('../../Transactions.js');

/**
 * Build a mock scraped Mizrahi row.
 * @param overrides - partial fields.
 * @returns complete row.
 */
function makeRow(
  overrides: Record<string, string | number | boolean> = {},
): Record<string, string | number | boolean> {
  return {
    RecTypeSpecified: true,
    MC02PeulaTaaEZ: '2025-01-15T10:00:00',
    MC02SchumEZ: 100,
    MC02AsmahtaMekoritEZ: '123456',
    MC02TnuaTeurEZ: 'Transfer',
    IsTodayTransaction: false,
    MC02ErehTaaEZ: '2025-01-15',
    MC02ShowDetailsEZ: '1',
    MC02KodGoremEZ: 'A',
    MC02SugTnuaKaspitEZ: 'B',
    MC02AgidEZ: 'C',
    MC02SeifMaralEZ: 'D',
    MC02NoseMaralEZ: 'E',
    TransactionNumber: 1,
    ...overrides,
  };
}

/**
 * No-op more details getter.
 * @returns Empty details with no memo.
 */
const NO_DETAILS = (): Promise<{ entries: Record<string, string>; memo: undefined }> =>
  Promise.resolve({ entries: {}, memo: undefined });

describe('buildRowBase', () => {
  it('sets Completed status for non-today transaction', () => {
    const result = MOD.buildRowBase({
      row: makeRow() as never,
      txnDate: '2025-01-15T00:00:00.000Z',
      moreDetails: { entries: {}, memo: undefined },
      isPendingIfTodayTransaction: false,
    });
    expect(result.status).toBe(TXN_STATUSES.Completed);
  });

  it('sets Pending status when isPendingIfTodayTransaction and IsTodayTransaction', () => {
    const result = MOD.buildRowBase({
      row: makeRow({ IsTodayTransaction: true }) as never,
      txnDate: '2025-01-15T00:00:00.000Z',
      moreDetails: { entries: {}, memo: undefined },
      isPendingIfTodayTransaction: true,
    });
    expect(result.status).toBe(TXN_STATUSES.Pending);
  });

  it('sets Completed when isPendingIfTodayTransaction but not IsTodayTransaction', () => {
    const result = MOD.buildRowBase({
      row: makeRow({ IsTodayTransaction: false }) as never,
      txnDate: '2025-01-15T00:00:00.000Z',
      moreDetails: { entries: {}, memo: undefined },
      isPendingIfTodayTransaction: true,
    });
    expect(result.status).toBe(TXN_STATUSES.Completed);
  });
});

describe('convertOneRow', () => {
  it('includes rawTransaction when option set', async () => {
    const result = await MOD.convertOneRow({
      row: makeRow() as never,
      getMoreDetails: NO_DETAILS as never,
      isPendingIfTodayTransaction: false,
      options: { includeRawTransaction: true } as never,
    });
    expect(result.rawTransaction).toBeDefined();
  });

  it('omits rawTransaction by default', async () => {
    const result = await MOD.convertOneRow({
      row: makeRow() as never,
      getMoreDetails: NO_DETAILS as never,
      isPendingIfTodayTransaction: false,
    });
    expect(result.rawTransaction).toBeUndefined();
  });
});

describe('mapPendingRow', () => {
  it('maps valid pending row', () => {
    const result = MOD.mapPendingRow(['15/01/25', 'Purchase', 'ref', '1,000.50']);
    expect('isEmpty' in result).toBe(false);
    if (!('isEmpty' in result)) {
      expect(result.status).toBe(TXN_STATUSES.Pending);
      expect(result.originalAmount).toBeCloseTo(1000.5);
    }
  });
});

describe('convertTransactions', () => {
  it('converts multiple rows', async () => {
    const rows = [makeRow(), makeRow({ MC02TnuaTeurEZ: 'Payment' })];
    const result = await MOD.convertTransactions({
      txns: rows as never,
      getMoreDetails: NO_DETAILS as never,
    });
    expect(result).toHaveLength(2);
  });
});
