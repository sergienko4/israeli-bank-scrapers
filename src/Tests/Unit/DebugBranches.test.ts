/**
 * Branch coverage tests for Debug.ts.
 * Targets: runWithBankContext (sync, async, nesting, sentinel verification),
 * getDebug (all log levels, distinct module loggers).
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

  it('executes the callback (verified via sentinel)', () => {
    let callResult = 'not-called';
    runWithBankContext('max', () => {
      callResult = 'was-called';
    });
    expect(callResult).toBe('was-called');
  });
});

describe('getDebug — child logger module name', () => {
  const logLevels = ['trace', 'debug', 'info', 'warn', 'error', 'fatal'] as const;

  it.each(logLevels)('logs at %s level without error', level => {
    const log = getDebug('branch-test');
    expect(() => {
      (log[level] as (...args: unknown[]) => string)('test');
    }).not.toThrow();
  });

  it('creates distinct loggers for different modules', () => {
    const log1 = getDebug('module-alpha');
    const log2 = getDebug('module-beta');
    expect(log1).not.toBe(log2);
  });
});
