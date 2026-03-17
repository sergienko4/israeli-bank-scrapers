/**
 * Branch coverage tests for ResultFormatter.ts.
 * Targets: maskAccount (short vs long), maskAmount (null, positive, negative),
 * maskDesc (empty), formatDate (empty), safePad (null value),
 * formatResultSummary (success with accounts, failure, no accounts).
 */
import {
  formatResultSummary,
  maskAccount,
  maskAmount,
  maskDesc,
} from '../../Common/ResultFormatter.js';
import type { IScraperScrapingResult } from '../../Scrapers/Base/Interface.js';
import { TransactionStatuses, TransactionTypes } from '../../Transactions.js';

describe('maskAccount', () => {
  it('returns **** for short account numbers', () => {
    const masked123 = maskAccount('123');
    expect(masked123).toBe('****');
    const masked1234 = maskAccount('1234');
    expect(masked1234).toBe('****');
  });

  it('returns ****NNNN for longer account numbers', () => {
    const maskedLong = maskAccount('1234567');
    expect(maskedLong).toBe('****4567');
    const maskedMed = maskAccount('12345');
    expect(maskedMed).toBe('****2345');
  });

  it('handles empty string', () => {
    const maskedEmpty = maskAccount('');
    expect(maskedEmpty).toBe('****');
  });
});

describe('maskAmount', () => {
  it('returns *** for null/undefined', () => {
    const maskedUndef = maskAmount(undefined);
    expect(maskedUndef).toBe('  ***');
    const maskedNull = maskAmount(null as unknown as undefined);
    expect(maskedNull).toBe('  ***');
  });

  it('returns +*** for zero', () => {
    const maskedZero = maskAmount(0);
    expect(maskedZero).toBe(' +***');
  });

  it('returns +*** for positive', () => {
    const maskedPos = maskAmount(100);
    expect(maskedPos).toBe(' +***');
  });

  it('returns -*** for negative', () => {
    const maskedNeg = maskAmount(-50);
    expect(maskedNeg).toBe(' -***');
  });
});

describe('maskDesc', () => {
  it('returns *** for empty string', () => {
    const maskedEmpty = maskDesc('');
    expect(maskedEmpty).toBe('***');
  });

  it('masks after first 3 characters', () => {
    const maskedLong = maskDesc('Hello World');
    expect(maskedLong).toBe('Hel***');
  });

  it('handles string shorter than 3 chars', () => {
    const maskedShort = maskDesc('Hi');
    expect(maskedShort).toBe('Hi***');
  });
});

describe('formatResultSummary', () => {
  it('formats success result with accounts', () => {
    const result: IScraperScrapingResult = {
      success: true,
      accounts: [
        {
          accountNumber: '1234567',
          txns: [
            {
              type: TransactionTypes.Normal,
              date: '2025-06-15T00:00:00.000Z',
              processedDate: '2025-06-15T00:00:00.000Z',
              originalAmount: -100,
              originalCurrency: 'ILS',
              chargedAmount: -100,
              description: 'Test Purchase',
              memo: '',
              status: TransactionStatuses.Completed,
            },
          ],
          balance: 5000,
        },
      ],
    };
    const lines = formatResultSummary('Leumi', result);
    expect(lines.length).toBeGreaterThan(3);
    const joined = lines.join('\n');
    expect(joined).toContain('Leumi');
    expect(joined).toContain('success=true');
    expect(joined).toContain('****4567');
  });

  it('formats failure result', () => {
    const result: IScraperScrapingResult = {
      success: false,
      errorType: 'generic' as never,
      errorMessage: 'something broke',
    };
    const lines = formatResultSummary('Max', result);
    const joined = lines.join('\n');
    expect(joined).toContain('success=false');
    expect(joined).toContain('something broke');
  });

  it('formats success with empty accounts', () => {
    const result: IScraperScrapingResult = {
      success: true,
      accounts: [],
    };
    const lines = formatResultSummary('Hapoalim', result);
    const joined = lines.join('\n');
    expect(joined).toContain('success=true');
  });

  it('formats success with no accounts field', () => {
    const result: IScraperScrapingResult = {
      success: true,
    } as IScraperScrapingResult;
    const lines = formatResultSummary('Discount', result);
    const joined = lines.join('\n');
    expect(joined).toContain('success=true');
  });

  it('shows more line when transactions exceed preview limit', () => {
    const txn = {
      type: TransactionTypes.Normal,
      date: '2025-06-15T00:00:00.000Z',
      processedDate: '2025-06-15T00:00:00.000Z',
      originalAmount: -10,
      originalCurrency: 'ILS',
      chargedAmount: -10,
      description: 'Txn',
      memo: '',
      status: TransactionStatuses.Completed,
    };
    const result: IScraperScrapingResult = {
      success: true,
      accounts: [{ accountNumber: '9876543', txns: [txn, txn, txn, txn, txn], balance: 0 }],
    };
    const lines = formatResultSummary('Test', result);
    const joined = lines.join('\n');
    expect(joined).toContain('more');
  });

  it('formats failure with missing error details', () => {
    const result: IScraperScrapingResult = {
      success: false,
    } as IScraperScrapingResult;
    const lines = formatResultSummary('Bank', result);
    const joined = lines.join('\n');
    expect(joined).toContain('unknown');
    expect(joined).toContain('no error message');
  });

  it('handles transaction with null originalCurrency via safePad', () => {
    const txn = {
      type: TransactionTypes.Normal,
      date: '2025-06-15T00:00:00.000Z',
      processedDate: '2025-06-15T00:00:00.000Z',
      originalAmount: -10,
      originalCurrency: null as unknown as string,
      chargedAmount: -10,
      description: 'Txn',
      memo: '',
      status: TransactionStatuses.Completed,
    };
    const result: IScraperScrapingResult = {
      success: true,
      accounts: [{ accountNumber: '9876543', txns: [txn], balance: 0 }],
    };
    const lines = formatResultSummary('Test', result);
    expect(lines.length).toBeGreaterThan(3);
  });

  it('handles transaction with empty date', () => {
    const txn = {
      type: TransactionTypes.Normal,
      date: '',
      processedDate: '',
      originalAmount: -10,
      originalCurrency: 'ILS',
      chargedAmount: -10,
      description: 'Txn',
      memo: '',
      status: TransactionStatuses.Completed,
    };
    const result: IScraperScrapingResult = {
      success: true,
      accounts: [{ accountNumber: '9876543', txns: [txn], balance: 0 }],
    };
    const lines = formatResultSummary('Test', result);
    expect(lines.length).toBeGreaterThan(3);
  });
});
