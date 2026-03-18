/**
 * Branch coverage tests for Debug.ts.
 * Targets: censor (accountNumber, positive amount, zero/negative amount,
 * default redaction — it.each), runWithBankContext (sync return, async return,
 * nesting, callback-execution proof via spy), getDebug (all 6 log levels via
 * it.each, distinct module loggers).
 */
import { jest } from '@jest/globals';

import { censor, getDebug, runWithBankContext } from '../../Common/Debug.js';

describe('censor branches', () => {
  const cases = [
    {
      label: 'masks accountNumber to last 4',
      value: '1234567890' as unknown,
      path: ['accountNumber'],
      expected: '****7890',
    },
    {
      label: 'masks positive amount to +***',
      value: 500 as unknown,
      path: ['balance'],
      expected: '+***',
    },
    {
      label: 'masks zero amount to -***',
      value: 0 as unknown,
      path: ['chargedAmount'],
      expected: '-***',
    },
    {
      label: 'masks negative amount to -***',
      value: -200 as unknown,
      path: ['originalAmount'],
      expected: '-***',
    },
    {
      label: 'redacts unknown sensitive key',
      value: 'secret' as unknown,
      path: ['password'],
      expected: '[REDACTED]',
    },
  ];

  it.each(cases)('$label', ({ value, path, expected }) => {
    const censored = censor(value, path);
    expect(censored).toBe(expected);
  });
});

describe('Bank Context Execution', () => {
  it('executes function within bank context and returns result', () => {
    const result = runWithBankContext('hapoalim', () => 42);
    expect(result).toBe(42);
  });

  it('executes async function within bank context', async () => {
    const result = await runWithBankContext('leumi', () => {
      const logger = getDebug('test');
      logger.info('logging within bank context');
      return Promise.resolve('done');
    });
    expect(result).toBe('done');
  });

  it('nests bank contexts correctly', () => {
    const outer = runWithBankContext('amex', () => {
      const inner = runWithBankContext('isracard', () => 'inner');
      return `outer-${inner}`;
    });
    expect(outer).toBe('outer-inner');
  });

  it('proves callback executed via spy', () => {
    const spy = jest.fn(() => 'spy-result');
    const result = runWithBankContext('max', spy);
    expect(spy).toHaveBeenCalledTimes(1);
    expect(result).toBe('spy-result');
  });
});

describe('getDebug — child logger module name', () => {
  const logLevels = ['trace', 'debug', 'info', 'warn', 'error', 'fatal'] as const;

  it.each(logLevels)('logs at %s level without error', level => {
    const log = getDebug('branch-test');
    expect(() => {
      (log[level] as (...a: unknown[]) => string)('test');
    }).not.toThrow();
  });

  it('creates distinct loggers for different modules', () => {
    const log1 = getDebug('module-alpha');
    const log2 = getDebug('module-beta');
    expect(log1).not.toBe(log2);
  });
});
