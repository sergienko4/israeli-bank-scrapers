/**
 * Unit tests for `Logging/ChildLoggerProxy.buildDeferredLogger` — Proxy
 * that defers pino child creation until first property access.
 */

import { buildDeferredLogger } from '../../../../Scrapers/Pipeline/Logging/ChildLoggerProxy.js';

describe('Feature — buildDeferredLogger', () => {
  it('returns a Proxy that exposes pino logger methods on access', () => {
    const log = buildDeferredLogger('proxy-test-a');
    expect(typeof log.info).toBe('function');
    expect(typeof log.debug).toBe('function');
    expect(typeof log.warn).toBe('function');
    expect(typeof log.error).toBe('function');
    expect(typeof log.trace).toBe('function');
  });

  it('forwards .info() to the real pino child without throwing', () => {
    const log = buildDeferredLogger('proxy-test-b');
    expect(() => {
      log.info({ msg: 'hello from deferred proxy' });
    }).not.toThrow();
  });

  it('exposes a callable child() method that returns a sub-logger', () => {
    const log = buildDeferredLogger('proxy-test-c');
    const sub = log.child({ k: 'v' });
    expect(typeof sub.info).toBe('function');
    expect(() => {
      sub.info({ msg: 'sub' });
    }).not.toThrow();
  });

  it('builds independent proxies for distinct names', () => {
    const a = buildDeferredLogger('proxy-test-d1');
    const b = buildDeferredLogger('proxy-test-d2');
    expect(a).not.toBe(b);
    expect(typeof a.info).toBe('function');
    expect(typeof b.info).toBe('function');
  });

  it('survives multiple property reads on the same proxy', () => {
    const log = buildDeferredLogger('proxy-test-e');
    expect(typeof log.info).toBe('function');
    expect(typeof log.info).toBe('function');
    expect(() => {
      log.info({ msg: 'first' });
      log.info({ msg: 'second' });
    }).not.toThrow();
  });
});
