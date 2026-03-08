import pino from 'pino';
import { Writable } from 'stream';

import {
  formatResultSummary,
  maskAccount,
  maskAmount,
  maskDesc,
} from '../../Common/ResultFormatter.js';
import type { ScraperScrapingResult } from '../../Scrapers/Base/Interface.js';
import type { Transaction } from '../../Transactions.js';
import { TransactionStatuses, TransactionTypes } from '../../Transactions.js';

function txn(overrides: Partial<Transaction> = {}): Transaction {
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

describe('ResultFormatter — PII masking', () => {
  describe('maskAccount', () => {
    it('masks long account numbers to last 4 digits', () => {
      expect(maskAccount('12345678')).toBe('****5678');
    });

    it('fully masks short account numbers', () => {
      expect(maskAccount('1234')).toBe('****');
      expect(maskAccount('12')).toBe('****');
    });

    it('never exposes full account number', () => {
      const original = '9876543210';
      const masked = maskAccount(original);
      expect(masked).not.toContain(original);
      expect(masked).toBe('****3210');
    });
  });

  describe('maskAmount', () => {
    it('masks positive amounts', () => {
      expect(maskAmount(5000)).toBe(' +***');
    });

    it('masks negative amounts', () => {
      expect(maskAmount(-150.3)).toBe(' -***');
    });

    it('masks zero as positive', () => {
      expect(maskAmount(0)).toBe(' +***');
    });

    it('masks undefined amounts', () => {
      expect(maskAmount(undefined)).toBe('  ***');
    });

    it('never exposes actual amount value', () => {
      const masked = maskAmount(12345.67);
      expect(masked).not.toContain('12345');
      expect(masked).not.toContain('67');
    });
  });

  describe('maskDesc', () => {
    it('shows only first 3 chars of description', () => {
      expect(maskDesc('סופר שופ רמי לוי')).toBe('סופ***');
    });

    it('masks empty descriptions', () => {
      expect(maskDesc('')).toBe('***');
    });

    it('handles short descriptions', () => {
      expect(maskDesc('AB')).toBe('AB***');
    });

    it('never exposes full description', () => {
      const desc = 'Visa purchase at Amazon.com order #123456';
      const masked = maskDesc(desc);
      expect(masked).not.toContain('Amazon');
      expect(masked).not.toContain('123456');
      expect(masked).toBe('Vis***');
    });
  });

  describe('formatResultSummary — no sensitive data leaks', () => {
    it('masks all account numbers in output', () => {
      const result: ScraperScrapingResult = {
        success: true,
        accounts: [
          { accountNumber: '98765432', balance: 15000, txns: [] },
          { accountNumber: '11223344', balance: -500, txns: [] },
        ],
      };
      const lines = formatResultSummary('TestBank', result);
      const output = lines.join('\n');

      expect(output).not.toContain('98765432');
      expect(output).not.toContain('11223344');
      expect(output).toContain('****5432');
      expect(output).toContain('****3344');
    });

    it('masks all amounts in output', () => {
      const result: ScraperScrapingResult = {
        success: true,
        accounts: [{ accountNumber: '12345678', balance: 37666.9, txns: [] }],
      };
      const lines = formatResultSummary('TestBank', result);
      const output = lines.join('\n');

      expect(output).not.toContain('37666');
      expect(output).not.toContain('37,666');
    });

    it('masks transaction descriptions', () => {
      const result: ScraperScrapingResult = {
        success: true,
        accounts: [
          {
            accountNumber: '12345678',
            balance: 5000,
            txns: [txn({ description: 'Amazon purchase secret order' })],
          },
        ],
      };
      const lines = formatResultSummary('TestBank', result);
      const output = lines.join('\n');

      expect(output).not.toContain('Amazon purchase');
      expect(output).not.toContain('secret order');
      expect(output).toContain('Ama***');
    });

    it('masks transaction amounts', () => {
      const result: ScraperScrapingResult = {
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
      const result: ScraperScrapingResult = {
        success: true,
        accounts: [{ accountNumber: '12345678', balance: 1000, txns: fiveTxns }],
      };
      const lines = formatResultSummary('TestBank', result);
      const output = lines.join('\n');

      expect(output).toContain('Transactions: 5');
      expect(output).toContain('... +2 more');
    });

    it('handles null currency at runtime', () => {
      const result: ScraperScrapingResult = {
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
      const result: ScraperScrapingResult = { success: true, accounts: [] };
      const lines = formatResultSummary('Amex', result);
      const output = lines.join('\n');

      expect(output).toContain('Amex');
      expect(output).toContain('Result: success=true');
    });

    it('shows error type on failure without sensitive details', () => {
      const result: ScraperScrapingResult = {
        success: false,
        errorType: 'INVALID_PASSWORD' as ScraperScrapingResult['errorType'],
      };
      const lines = formatResultSummary('TestBank', result);
      const output = lines.join('\n');

      expect(output).toContain('success=false');
      expect(output).toContain('INVALID_PASSWORD');
    });
  });

  describe('logger output at info level — no PII leaks', () => {
    const ACCOUNT = '98765432109';
    const BALANCE = 37666.9;
    const DESCRIPTION = 'Amazon purchase secret order #789';
    const AMOUNT = -9876.54;

    function buildResult(): ScraperScrapingResult {
      return {
        success: true,
        accounts: [
          {
            accountNumber: ACCOUNT,
            balance: BALANCE,
            txns: [txn({ description: DESCRIPTION, originalAmount: AMOUNT })],
          },
        ],
      };
    }

    function createCapture(): { stream: Writable; output: () => string } {
      const chunks: string[] = [];
      const stream = new Writable({
        write(chunk: Buffer, _enc: string, cb: () => void): void {
          chunks.push(chunk.toString());
          cb();
        },
      });
      return { stream, output: () => chunks.join('') };
    }

    function captureInfoOutput(result: ScraperScrapingResult): string {
      const { stream, output } = createCapture();
      const logger = pino({ level: 'info' }, stream);
      const lines = formatResultSummary('TestBank', result);
      for (const line of lines) {
        logger.info(line);
      }
      return output();
    }

    it('info-level log does not contain full account number', () => {
      const output = captureInfoOutput(buildResult());
      expect(output).not.toContain(ACCOUNT);
      expect(output).toContain('****2109');
    });

    it('info-level log does not contain balance value', () => {
      const output = captureInfoOutput(buildResult());
      expect(output).not.toContain('37666');
    });

    it('info-level log does not contain full description', () => {
      const output = captureInfoOutput(buildResult());
      expect(output).not.toContain('Amazon purchase');
      expect(output).not.toContain('secret order');
      expect(output).not.toContain('#789');
    });

    it('info-level log does not contain transaction amount', () => {
      const output = captureInfoOutput(buildResult());
      expect(output).not.toContain('9876');
    });

    it('debug-level verbose logs are suppressed at info level', () => {
      const { stream, output } = createCapture();
      const logger = pino({ level: 'info' }, stream);
      logger.debug('navigateTo https://bank.com/secret-path → 200');
      logger.debug('fill #password with value');
      logger.debug('response: 200 https://api.bank.com/token=SECRET');
      expect(output()).toBe('');
    });

    it('trace-level logs are suppressed at info level', () => {
      const { stream, output } = createCapture();
      const logger = pino({ level: 'info' }, stream);
      logger.trace('[1/6] navigate: url=https://bank.com, frames=3');
      expect(output()).toBe('');
    });
  });

  describe('log level filtering — positive and negative', () => {
    function createCapture(): { stream: Writable; output: () => string } {
      const chunks: string[] = [];
      const stream = new Writable({
        write(chunk: Buffer, _enc: string, cb: () => void): void {
          chunks.push(chunk.toString());
          cb();
        },
      });
      return { stream, output: () => chunks.join('') };
    }

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

    it('false positive: info level does not accidentally print debug messages', () => {
      const { stream, output } = createCapture();
      const logger = pino({ level: 'info' }, stream);
      logger.debug('navigateTo https://bank.com/personal-area → 200');
      logger.debug('fill input#userCode with value');
      logger.debug('response: 200 https://api.bank.com/login');
      expect(output()).toBe('');
    });

    it('false positive: verbose debug data never leaks at info', () => {
      const { stream, output } = createCapture();
      const logger = pino({ level: 'info' }, stream);
      logger.debug({ url: 'https://bank.com', status: 200 }, 'navigation');
      logger.debug('selector resolved: #userCode → input[name="code"]');
      logger.info('login step completed');
      const logged = output();
      expect(logged).toContain('login step completed');
      expect(logged).not.toContain('bank.com');
      expect(logged).not.toContain('userCode');
      expect(logged).not.toContain('selector resolved');
    });
  });
});
