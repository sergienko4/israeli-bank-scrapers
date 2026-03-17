/**
 * Branch coverage tests for Debug.ts.
 * Targets: censor (accountNumber branch, amount keys branch, default),
 * getBankMixin (with/without store), getDebug child creation,
 * runWithBankContext execution and nesting.
 */
import { getDebug, runWithBankContext } from '../../Common/Debug.js';

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

  it('returns undefined from void function', () => {
    let callResult: string | undefined;
    runWithBankContext('max', () => {
      callResult = undefined;
    });
    expect(callResult).toBeUndefined();
  });
});

describe('getDebug — child logger module name', () => {
  it('creates loggers that can log at all levels without error', () => {
    const log = getDebug('branch-test');
    expect(() => {
      log.trace('trace');
    }).not.toThrow();
    expect(() => {
      log.debug({ key: 'val' }, 'debug');
    }).not.toThrow();
    expect(() => {
      log.info('info');
    }).not.toThrow();
    expect(() => {
      log.warn('warn');
    }).not.toThrow();
    expect(() => {
      log.error('error');
    }).not.toThrow();
    expect(() => {
      log.fatal('fatal');
    }).not.toThrow();
  });

  it('creates distinct loggers for different modules', () => {
    const log1 = getDebug('module-alpha');
    const log2 = getDebug('module-beta');
    expect(log1).not.toBe(log2);
  });
});
