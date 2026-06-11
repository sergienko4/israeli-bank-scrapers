/**
 * Unit tests for `Logging/RootLogger` — lazy pino instantiation and
 * cache-state predicate.
 */

import {
  buildActiveOptions,
  buildPinoOptions,
  buildSilentOptions,
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

describe('Feature — buildPinoOptions silent vs active dispatch (CR #337)', () => {
  it('returns level: "silent" when transport is the disabled sentinel (false)', () => {
    const opts = buildPinoOptions(false);
    expect(opts.level).toBe('silent');
    expect('transport' in opts).toBe(false);
  });

  it('returns env-driven level + transport pass-through when transport is real', () => {
    const fakeTransport = { target: 'pino/file', options: { destination: 1 } };
    const opts = buildPinoOptions(fakeTransport);
    expect(opts.transport).toBe(fakeTransport);
    expect(opts.level).toBe(process.env.LOG_LEVEL ?? 'info');
  });

  it('buildSilentOptions never omits redact / mixin', () => {
    const opts = buildSilentOptions();
    expect(opts.redact).toBeDefined();
    expect(typeof opts.mixin).toBe('function');
  });

  it('buildActiveOptions carries the transport reference unchanged', () => {
    const fakeTransport = { target: 'pino-pretty', options: { colorize: true } };
    const opts = buildActiveOptions(fakeTransport);
    expect(opts.transport).toBe(fakeTransport);
  });
});
