import { jest } from '@jest/globals';

import type { IMovement } from '../../Scrapers/OneZero/Interfaces/Movement.js';

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

const MAPPERS = await import('../../Scrapers/OneZero/OneZeroMappers.js');
const TX = await import('../../Transactions.js');

/** Unicode LTR mark used in OneZero API responses. */
const LTR = '\u202d';

/**
 * Build a minimal IMovement for testing.
 * @param overrides - fields to override on the base movement
 * @returns a movement stub
 */
function makeMovement(overrides: Partial<IMovement> = {}): IMovement {
  return {
    accountId: 'acc-1',
    bankCurrencyAmount: '100.00',
    bookingDate: '2024-06-15',
    conversionRate: '1',
    creditDebit: 'DEBIT',
    description: 'Test purchase',
    isReversed: false,
    movementAmount: '100.00',
    movementCurrency: 'ILS',
    movementId: 'mv-001',
    movementTimestamp: '2024-06-15T10:30:00Z',
    movementType: 'PAYMENT',
    portfolioId: 'port-1',
    runningBalance: '5000.00',
    transaction: null,
    valueDate: '2024-06-15',
    ...overrides,
  };
}

/** Minimal scraper options stub. */
const BASE_OPTIONS = { companyId: 'oneZero' } as never;

/** Options with includeRawTransaction enabled. */
const RAW_OPTIONS = { companyId: 'oneZero', includeRawTransaction: true } as never;

describe('OneZeroMappers', () => {
  describe('sanitize', () => {
    it('returns plain text unchanged', () => {
      const result = MAPPERS.sanitize('Hello World');
      expect(result).toBe('Hello World');
    });

    it('trims whitespace', () => {
      const result = MAPPERS.sanitize('  hello  ');
      expect(result).toBe('hello');
    });

    it('strips LTR marks and reverses Hebrew', () => {
      const input = `${LTR}םולש`;
      const result = MAPPERS.sanitize(input);
      expect(result).toBe('שלום');
    });

    it('handles mixed Hebrew and English with LTR marks', () => {
      const input = `${LTR}pay - תוריש`;
      const result = MAPPERS.sanitize(input);
      expect(result).toBe('pay - שירות');
    });

    it('returns empty string for empty input', () => {
      const result = MAPPERS.sanitize('');
      expect(result).toBe('');
    });

    it('handles text with only LTR marks', () => {
      const input = `${LTR}${LTR}`;
      const result = MAPPERS.sanitize(input);
      expect(result).toBe('');
    });

    it('preserves special characters without LTR marks', () => {
      const result = MAPPERS.sanitize('cafe & bar #1');
      expect(result).toBe('cafe & bar #1');
    });

    it('handles Hebrew with embedded quotes', () => {
      const input = `${LTR}ח"של`;
      const result = MAPPERS.sanitize(input);
      expect(result).toBe('לש"ח');
    });
  });

  describe('fallbackBalance', () => {
    it('returns 0 for empty array', () => {
      const result = MAPPERS.fallbackBalance([]);
      expect(result).toBe(0);
    });

    it('returns last movement runningBalance', () => {
      const movements = [
        makeMovement({ runningBalance: '1000.00' }),
        makeMovement({ runningBalance: '2500.50' }),
      ];
      const result = MAPPERS.fallbackBalance(movements);
      expect(result).toBe(2500.5);
    });

    it('returns NaN for non-numeric balance', () => {
      const movements = [makeMovement({ runningBalance: 'invalid' })];
      const result = MAPPERS.fallbackBalance(movements);
      expect(result).toBeNaN();
    });

    it('handles negative balance', () => {
      const movements = [makeMovement({ runningBalance: '-300.75' })];
      const result = MAPPERS.fallbackBalance(movements);
      expect(result).toBe(-300.75);
    });

    it('works with single movement', () => {
      const movements = [makeMovement({ runningBalance: '42' })];
      const result = MAPPERS.fallbackBalance(movements);
      expect(result).toBe(42);
    });
  });

  describe('sortByTimestamp', () => {
    it('sorts ascending by movementTimestamp', () => {
      const movements = [
        makeMovement({ movementTimestamp: '2024-06-16T00:00:00Z', movementId: 'b' }),
        makeMovement({ movementTimestamp: '2024-06-14T00:00:00Z', movementId: 'a' }),
        makeMovement({ movementTimestamp: '2024-06-15T00:00:00Z', movementId: 'c' }),
      ];
      const sorted = MAPPERS.sortByTimestamp(movements);
      const ids = sorted.map(m => m.movementId);
      expect(ids).toEqual(['a', 'c', 'b']);
    });

    it('returns empty array for empty input', () => {
      const result = MAPPERS.sortByTimestamp([]);
      expect(result).toEqual([]);
    });

    it('handles single element', () => {
      const movements = [makeMovement()];
      const sorted = MAPPERS.sortByTimestamp(movements);
      expect(sorted).toHaveLength(1);
    });
  });

  describe('mapMovement', () => {
    it('maps DEBIT movement with negative modifier', () => {
      const mv = makeMovement({ creditDebit: 'DEBIT', movementAmount: '150.00' });
      const result = MAPPERS.mapMovement(mv, BASE_OPTIONS);
      expect(result.chargedAmount).toBe(-150);
      expect(result.originalAmount).toBe(-150);
      expect(result.status).toBe(TX.TransactionStatuses.Completed);
      expect(result.type).toBe(TX.TransactionTypes.Normal);
    });

    it('maps CREDIT movement with positive modifier', () => {
      const mv = makeMovement({ creditDebit: 'CREDIT', movementAmount: '200.00' });
      const result = MAPPERS.mapMovement(mv, BASE_OPTIONS);
      expect(result.chargedAmount).toBe(200);
      expect(result.originalAmount).toBe(200);
    });

    it('sets Installments type for recurrent transaction', () => {
      const mv = makeMovement({
        transaction: {
          enrichment: {
            recurrences: [{ dataSource: 'test', isRecurrent: true }],
          },
        },
      });
      const result = MAPPERS.mapMovement(mv, BASE_OPTIONS);
      expect(result.type).toBe(TX.TransactionTypes.Installments);
    });

    it('sets Normal type for non-recurrent transaction', () => {
      const mv = makeMovement({
        transaction: {
          enrichment: {
            recurrences: [{ dataSource: 'test', isRecurrent: false }],
          },
        },
      });
      const result = MAPPERS.mapMovement(mv, BASE_OPTIONS);
      expect(result.type).toBe(TX.TransactionTypes.Normal);
    });

    it('includes rawTransaction when option set', () => {
      const mv = makeMovement();
      const result = MAPPERS.mapMovement(mv, RAW_OPTIONS);
      expect(result.rawTransaction).toBeDefined();
    });

    it('omits rawTransaction by default', () => {
      const mv = makeMovement();
      const result = MAPPERS.mapMovement(mv, BASE_OPTIONS);
      expect(result.rawTransaction).toBeUndefined();
    });

    it('uses movementId as identifier', () => {
      const mv = makeMovement({ movementId: 'unique-123' });
      const result = MAPPERS.mapMovement(mv, BASE_OPTIONS);
      expect(result.identifier).toBe('unique-123');
    });

    it('sanitizes description with LTR marks', () => {
      const mv = makeMovement({ description: `${LTR}הנקי` });
      const result = MAPPERS.mapMovement(mv, BASE_OPTIONS);
      expect(result.description).toBe('יקנה');
    });

    it('handles null transaction field', () => {
      const mv = makeMovement({ transaction: null });
      const result = MAPPERS.mapMovement(mv, BASE_OPTIONS);
      expect(result.type).toBe(TX.TransactionTypes.Normal);
    });

    it('handles missing enrichment', () => {
      const mv = makeMovement({ transaction: {} });
      const result = MAPPERS.mapMovement(mv, BASE_OPTIONS);
      expect(result.type).toBe(TX.TransactionTypes.Normal);
    });

    it('handles zero amount', () => {
      const mv = makeMovement({ movementAmount: '0', creditDebit: 'DEBIT' });
      const result = MAPPERS.mapMovement(mv, BASE_OPTIONS);
      expect(result.chargedAmount).toBe(-0);
      expect(result.originalAmount).toBe(-0);
    });

    it('uses movement currency', () => {
      const mv = makeMovement({ movementCurrency: 'USD' });
      const result = MAPPERS.mapMovement(mv, BASE_OPTIONS);
      expect(result.chargedCurrency).toBe('USD');
      expect(result.originalCurrency).toBe('USD');
    });

    it('maps dates correctly', () => {
      const mv = makeMovement({
        valueDate: '2024-06-10',
        movementTimestamp: '2024-06-15T10:00:00Z',
      });
      const result = MAPPERS.mapMovement(mv, BASE_OPTIONS);
      expect(result.date).toBe('2024-06-10');
      expect(result.processedDate).toBe('2024-06-15T10:00:00Z');
    });
  });
});
