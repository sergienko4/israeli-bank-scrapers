import { jest } from '@jest/globals';
import pino from 'pino';
import { Writable } from 'stream';

import {
  formatResultSummary,
  maskAccount,
  maskAmount,
  maskDesc,
} from '../../Common/ResultFormatter.js';
import type { IScraperScrapingResult } from '../../Scrapers/Base/Interface.js';
import type { ITransaction } from '../../Transactions.js';
import { TransactionStatuses, TransactionTypes } from '../../Transactions.js';

/**
 * Creates a test transaction with sensible defaults.
 * @param overrides - fields to override
 * @returns a transaction object
 */
function txn(overrides: Partial<ITransaction> = {}): ITransaction {
  return {
    type: TransactionTypes.Normal,
    date: '2026-02-18T00:00:00.000Z',
    processedDate: '2026-02-20T00:00:00.000Z',
    originalAmount: -150.3,
    originalCurrency: 'ILS',
    chargedAmount: -150.3,
    description: 'סופר שופ רמי לוי',
    status: TransactionStatuses.Completed,
    ...overrides,
  };
}

/**
 * Creates a writable stream that captures output to a string.
 * @returns stream and output accessor
 */
function createCapture(): { stream: Writable; output: () => string } {
  const chunks: string[] = [];
  const stream = new Writable({
    write: jest.fn((chunk: Buffer, _enc: BufferEncoding, cb: () => string) => {
      const text = chunk.toString();
      chunks.push(text);
      cb();
    }),
  });
  /**
   * Accessor for captured output.
   * @returns captured output
   */
  const output = (): string => chunks.join('');
  return { stream, output };
}

/**
 * Captures info-level log output for a given scraper result.
 * @param result - the scraper result to log
 * @returns the captured log output string
 */
function captureInfoOutput(result: IScraperScrapingResult): string {
  const { stream, output } = createCapture();
  const logger = pino({ level: 'info' }, stream);
  const lines = formatResultSummary('TestBank', result);
  for (const line of lines) {
    logger.info(line);
  }
  return output();
}

describe('ResultFormatter — PII masking', () => {
  describe('maskAccount', () => {
    it('masks long account numbers to last 4 digits', () => {
      const masked = maskAccount('12345678');
      expect(masked).toBe('****5678');
    });
    it('masks short accounts and never exposes full number', () => {
      const masked4 = maskAccount('1234');
      const masked2 = maskAccount('12');
      const maskedLong = maskAccount('9876543210');
      expect(masked4).toBe('****');
      expect(masked2).toBe('****');
      expect(maskedLong).toBe('****3210');
      expect(maskedLong).not.toContain('9876543210');
    });
  });
  describe('maskAmount', () => {
    it('masks amounts by sign', () => {
      const pos = maskAmount(5000);
      const neg = maskAmount(-150.3);
      const zero = maskAmount(0);
      const undef = maskAmount(undefined);
      expect(pos).toBe(' +***');
      expect(neg).toBe(' -***');
      expect(zero).toBe(' +***');
      expect(undef).toBe('  ***');
    });
    it('never exposes actual amount value', () => {
      const masked = maskAmount(12345.67);
      expect(masked).not.toContain('12345');
    });
  });
  describe('maskDesc', () => {
    it('shows only first 3 chars and masks the rest', () => {
      const hebrew = maskDesc('סופר שופ רמי לוי');
      const empty = maskDesc('');
      const short = maskDesc('AB');
      expect(hebrew).toBe('סופ***');
      expect(empty).toBe('***');
      expect(short).toBe('AB***');
    });
    it('never exposes full description', () => {
      const masked = maskDesc('Visa purchase at Amazon.com order #123456');
      expect(masked).toBe('Vis***');
    });
  });
  describe('formatResultSummary — no sensitive data leaks', () => {
    it('masks all account numbers in output', () => {
      const result: IScraperScrapingResult = {
        success: true,
        accounts: [
          { accountNumber: '98765432', balance: 15000, txns: [] },
          { accountNumber: '11223344', balance: -500, txns: [] },
        ],
      };
      const output = formatResultSummary('TestBank', result).join('\n');
      expect(output).not.toContain('98765432');
      expect(output).not.toContain('11223344');
      expect(output).toContain('****5432');
      expect(output).toContain('****3344');
    });
    it('masks all amounts in output', () => {
      const result: IScraperScrapingResult = {
        success: true,
        accounts: [{ accountNumber: '12345678', balance: 37666.9, txns: [] }],
      };
      const output = formatResultSummary('TestBank', result).join('\n');
      expect(output).not.toContain('37666');
      expect(output).not.toContain('37,666');
    });
    it('masks transaction descriptions', () => {
      const result: IScraperScrapingResult = {
        success: true,
        accounts: [
          {
            accountNumber: '12345678',
            balance: 5000,
            txns: [txn({ description: 'Amazon purchase secret order' })],
          },
        ],
      };
      const output = formatResultSummary('TestBank', result).join('\n');
      expect(output).not.toContain('Amazon purchase');
      expect(output).not.toContain('secret order');
      expect(output).toContain('Ama***');
    });

    it('masks transaction amounts', () => {
      const result: IScraperScrapingResult = {
        success: true,
        accounts: [
          {
            accountNumber: '12345678',
            balance: 5000,
            txns: [txn({ originalAmount: -9876.54 })],
          },
        ],
      };
      const lines = formatResultSummary('TestBank', result);
      const output = lines.join('\n');
      expect(output).not.toContain('9876');
      expect(output).toContain('-***');
    });
    it('limits transaction preview to 3', () => {
      const fiveTxns = Array.from({ length: 5 }, () => txn());
      const result: IScraperScrapingResult = {
        success: true,
        accounts: [{ accountNumber: '12345678', balance: 1000, txns: fiveTxns }],
      };
      const output = formatResultSummary('TestBank', result).join('\n');
      expect(output).toContain('Transactions: 5');
      expect(output).toContain('... +2 more');
    });
    it('handles null currency at runtime', () => {
      const result: IScraperScrapingResult = {
        success: true,
        accounts: [
          {
            accountNumber: '12345678',
            balance: 0,
            txns: [txn({ originalCurrency: null as unknown as string })],
          },
        ],
      };
      expect(() => formatResultSummary('TestBank', result)).not.toThrow();
    });

    it('shows bank name and success status', () => {
      const result: IScraperScrapingResult = { success: true, accounts: [] };
      const output = formatResultSummary('Amex', result).join('\n');
      expect(output).toContain('Amex');
      expect(output).toContain('Result: success=true');
    });
    it('shows error type on failure without sensitive details', () => {
      const result: IScraperScrapingResult = {
        success: false,
        errorType: 'INVALID_PASSWORD' as IScraperScrapingResult['errorType'],
      };
      const output = formatResultSummary('TestBank', result).join('\n');
      expect(output).toContain('success=false');
      expect(output).toContain('INVALID_PASSWORD');
    });
  });

  describe('logger output at info level — no PII leaks', () => {
    const piiAccount = '98765432109';
    const piiDescription = 'Amazon purchase secret order #789';
    const piiAmount = -9876.54;

    /**
     * Builds a scraper result containing PII for leak testing.
     * @returns a scraper result with sensitive data
     */
    function buildResult(): IScraperScrapingResult {
      return {
        success: true,
        accounts: [
          {
            accountNumber: piiAccount,
            balance: 37666.9,
            txns: [txn({ description: piiDescription, originalAmount: piiAmount })],
          },
        ],
      };
    }

    it('info-level log does not contain full account number', () => {
      const result = buildResult();
      const output = captureInfoOutput(result);
      expect(output).not.toContain(piiAccount);
      expect(output).toContain('****2109');
    });

    it('info-level log does not contain balance value', () => {
      const result = buildResult();
      const output = captureInfoOutput(result);
      expect(output).not.toContain('37666');
    });

    it('info-level log does not contain full description', () => {
      const result = buildResult();
      const output = captureInfoOutput(result);
      expect(output).not.toContain('Amazon purchase');
      expect(output).not.toContain('secret order');
      expect(output).not.toContain('#789');
    });

    it('info-level log does not contain transaction amount', () => {
      const result = buildResult();
      const output = captureInfoOutput(result);
      expect(output).not.toContain('9876');
    });

    it('debug-level verbose logs are suppressed at info level', () => {
      const { stream, output } = createCapture();
      const logger = pino({ level: 'info' }, stream);
      logger.debug('navigateTo https://bank.com/secret-path → 200');
      logger.debug('fill #password with value');
      logger.debug('response: 200 https://api.bank.com/token=SECRET');
      const logged = output();
      expect(logged).toBe('');
    });

    it('trace-level logs are suppressed at info level', () => {
      const { stream, output } = createCapture();
      const logger = pino({ level: 'info' }, stream);
      logger.trace('[1/6] navigate: url=https://bank.com, frames=3');
      const logged = output();
      expect(logged).toBe('');
    });
  });

  describe('log level filtering — positive and negative', () => {
    it('info level: prints info, suppresses debug and trace', () => {
      const { stream, output } = createCapture();
      const logger = pino({ level: 'info' }, stream);
      logger.info('chain: navigate → fill → submit');
      logger.debug('navigateTo https://bank.com → 200');
      logger.trace('[1/3] navigate: url=about:blank, frames=0');
      const logged = output();
      expect(logged).toContain('chain: navigate');
      expect(logged).not.toContain('navigateTo');
      expect(logged).not.toContain('about:blank');
    });
    it('debug level: prints info and debug, suppresses trace', () => {
      const { stream, output } = createCapture();
      const logger = pino({ level: 'debug' }, stream);
      logger.info('chain: navigate → fill');
      logger.debug('navigateTo https://bank.com → 200');
      logger.trace('[1/3] navigate: url=about:blank');
      const logged = output();
      expect(logged).toContain('chain: navigate');
      expect(logged).toContain('navigateTo');
      expect(logged).not.toContain('about:blank');
    });
    it('trace level: prints info, debug, and trace', () => {
      const { stream, output } = createCapture();
      const logger = pino({ level: 'trace' }, stream);
      logger.info('chain: navigate → fill');
      logger.debug('navigateTo https://bank.com → 200');
      logger.trace('[1/3] navigate: url=about:blank');
      const logged = output();
      expect(logged).toContain('chain: navigate');
      expect(logged).toContain('navigateTo');
      expect(logged).toContain('about:blank');
    });
    it('warn level: suppresses info, debug, and trace', () => {
      const { stream, output } = createCapture();
      const logger = pino({ level: 'warn' }, stream);
      logger.info('chain result summary');
      logger.debug('fill #password');
      logger.trace('url=https://bank.com');
      logger.warn('WAF 403 detected');
      const logged = output();
      expect(logged).not.toContain('chain result');
      expect(logged).not.toContain('fill');
      expect(logged).not.toContain('bank.com');
      expect(logged).toContain('WAF 403');
    });
  });
});
