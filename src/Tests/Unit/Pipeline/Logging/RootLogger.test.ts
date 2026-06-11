/**
 * Unit tests for `Logging/RootLogger` — lazy pino instantiation and
 * cache-state predicate.
 */

import {
  getRootLogger,
  isRootLoggerCached,
} from '../../../../Scrapers/Pipeline/Logging/RootLogger.js';

describe('Feature — getRootLogger', () => {
  it('returns a pino-shaped logger with the level/info/error methods', () => {
    const log = getRootLogger();
    expect(typeof log.info).toBe('function');
    expect(typeof log.error).toBe('function');
    expect(typeof log.warn).toBe('function');
    expect(typeof log.debug).toBe('function');
    expect(typeof log.child).toBe('function');
  });

  it('does not throw when emitting through the root logger', () => {
    const log = getRootLogger();
    expect(() => {
      log.info({ msg: 'rootlogger-test' });
    }).not.toThrow();
  });
});

describe('Feature — isRootLoggerCached', () => {
  it('returns a boolean reflecting the cache slot', () => {
    expect(typeof isRootLoggerCached()).toBe('boolean');
  });

  it('stays stable across repeated calls in the same tick', () => {
    const wasCached = isRootLoggerCached();
    const isCached = isRootLoggerCached();
    expect(isCached).toBe(wasCached);
  });
});
