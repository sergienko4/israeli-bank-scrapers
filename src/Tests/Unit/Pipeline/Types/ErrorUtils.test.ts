/**
 * Unit tests for Types/ErrorUtils — normalise thrown values to strings.
 */

import {
  toError,
  toErrorMessage,
  UNREPRESENTABLE_ERROR,
} from '../../../../Scrapers/Pipeline/Types/ErrorUtils.js';

/**
 * Custom Error subclass used by the throwing-toString / Symbol.toPrimitive
 * fixtures below. The project lint rule bans bare `throw new Error()`
 * to enforce PII-safe error classes; using a named subclass keeps the
 * fixtures realistic while satisfying the rule.
 */
class FixtureBoomError extends Error {
  /**
   * Creates a new FixtureBoomError.
   *
   * @param message - Marker text identifying the throwing fixture.
   */
  constructor(message: string) {
    super(message);
    this.name = 'FixtureBoomError';
  }
}

describe('toErrorMessage', () => {
  it('returns Error.message for Error instances', () => {
    const err = new Error('something failed');
    const msg = toErrorMessage(err);
    expect(msg).toBe('something failed');
  });

  it('returns original string when value is a string', () => {
    const msg = toErrorMessage('raw string');
    expect(msg).toBe('raw string');
  });

  it('preserves empty Error.message', () => {
    const err = new Error('');
    const msg = toErrorMessage(err);
    expect(msg).toBe('');
  });

  it('preserves empty string', () => {
    const msg = toErrorMessage('');
    expect(msg).toBe('');
  });

  it('preserves subclass of Error (TypeError) message', () => {
    const err = new TypeError('bad type');
    const msg = toErrorMessage(err);
    expect(msg).toBe('bad type');
  });

  it('safely stringifies non-Error / non-string values', () => {
    const nullMsg = toErrorMessage(null);
    const undefMsg = toErrorMessage(undefined);
    const numMsg = toErrorMessage(42);
    const boolMsg = toErrorMessage(true);
    const objMsg = toErrorMessage({ foo: 'bar' });
    expect(nullMsg).toBe('null');
    expect(undefMsg).toBe('undefined');
    expect(numMsg).toBe('42');
    expect(boolMsg).toBe('true');
    expect(objMsg).toBe('[object Object]');
  });

  it('returns sentinel when value coercion throws', () => {
    const evil = {
      /**
       * Pathological `toString` override — mirrors the toError sentinel
       * tests below. `safeStringify` (called by `toErrorMessage` for
       * non-Error / non-string inputs) must swallow this and return
       * {@link UNREPRESENTABLE_ERROR}.
       *
       * @returns Never; always throws {@link FixtureBoomError}.
       */
      toString(): string {
        throw new FixtureBoomError('boom');
      },
    };
    const msg = toErrorMessage(evil);
    expect(msg).toBe(UNREPRESENTABLE_ERROR);
  });

  it('detects cross-realm Errors via [[Class]] brand', () => {
    const crossRealmError = Object.create(null) as Record<string, unknown> & {
      [Symbol.toStringTag]?: string;
    };
    crossRealmError.message = 'cross-realm boom';
    crossRealmError[Symbol.toStringTag] = 'Error';
    const msg = toErrorMessage(crossRealmError);
    expect(msg).toBe('cross-realm boom');
  });
});

describe('toError — never-throws contract', () => {
  it('returns the same reference for Error instances (preserves .code/.errno)', () => {
    const original = Object.assign(new Error('connect ECONNREFUSED'), {
      code: 'ECONNREFUSED',
      errno: -111,
    });
    const normalized = toError(original);
    expect(normalized).toBe(original);
    expect((normalized as NodeJS.ErrnoException).code).toBe('ECONNREFUSED');
  });

  it('preserves Error subclass identity (TypeError, RangeError, etc.)', () => {
    const original = new TypeError('bad type');
    const normalized = toError(original);
    expect(normalized).toBe(original);
    expect(normalized).toBeInstanceOf(TypeError);
  });

  it('wraps strings without prefixing "Error: "', () => {
    const normalized = toError('raw thrown string');
    expect(normalized).toBeInstanceOf(Error);
    expect(normalized.message).toBe('raw thrown string');
  });

  it('handles empty string thrown', () => {
    const normalized = toError('');
    expect(normalized.message).toBe('');
  });

  it('handles null', () => {
    const normalized = toError(null);
    expect(normalized.message).toBe('null');
  });

  it('handles undefined', () => {
    const normalized = toError(undefined);
    expect(normalized.message).toBe('undefined');
  });

  it('handles numbers (including NaN and Infinity)', () => {
    expect(toError(42).message).toBe('42');
    expect(toError(Number.NaN).message).toBe('NaN');
    expect(toError(Number.POSITIVE_INFINITY).message).toBe('Infinity');
  });

  it('handles booleans', () => {
    expect(toError(true).message).toBe('true');
    expect(toError(false).message).toBe('false');
  });

  it('handles plain objects', () => {
    const normalized = toError({ foo: 'bar' });
    expect(normalized.message).toBe('[object Object]');
  });

  it('handles arrays', () => {
    const normalized = toError([1, 2, 3]);
    expect(normalized.message).toBe('1,2,3');
  });

  it('handles symbols', () => {
    const symbolInput = Symbol('boom');
    const normalized = toError(symbolInput);
    expect(normalized.message).toBe('Symbol(boom)');
  });

  it('handles bigints', () => {
    const bigintInput = BigInt(123);
    const normalized = toError(bigintInput);
    expect(normalized.message).toBe('123');
  });

  it('returns sentinel when toString() itself throws', () => {
    const evil = {
      /**
       * Pathological `toString` override that simulates a value whose
       * coercion crashes — the sentinel branch of `safeStringify`
       * must catch this without re-throwing.
       *
       * @returns Never; always throws {@link FixtureBoomError}.
       */
      toString(): string {
        throw new FixtureBoomError('boom');
      },
    };
    const normalized = toError(evil);
    expect(normalized.message).toBe(UNREPRESENTABLE_ERROR);
  });

  it('returns sentinel when Symbol.toPrimitive throws', () => {
    const evil = {
      /**
       * Pathological `Symbol.toPrimitive` override — `String(value)`
       * prefers this hook over `toString`, so this is the other
       * coercion path the sentinel branch must guard.
       *
       * @returns Never; always throws {@link FixtureBoomError}.
       */
      [Symbol.toPrimitive](): string {
        throw new FixtureBoomError('boom');
      },
    };
    const normalized = toError(evil);
    expect(normalized.message).toBe(UNREPRESENTABLE_ERROR);
  });

  it('detects cross-realm Errors via [[Class]] brand', () => {
    /**
     * Synthetic cross-realm Error — a plain object whose
     * Symbol.toStringTag pretends to be Error. `instanceof Error`
     * returns false (no prototype link) but the [[Class]] brand
     * matches, which is exactly the Jest VM / node:vm / iframe
     * scenario this helper guards against.
     */
    const crossRealmError = Object.create(null) as Record<string, unknown> & {
      [Symbol.toStringTag]?: string;
    };
    crossRealmError.message = 'cross-realm boom';
    crossRealmError[Symbol.toStringTag] = 'Error';
    const normalized = toError(crossRealmError);
    expect(normalized).toBe(crossRealmError as unknown as Error);
  });

  it('never throws for any input value', () => {
    const evilToString = {
      /**
       * Pathological `toString` used to assert the never-throws
       * contract holds even when coercion itself crashes.
       *
       * @returns Never; always throws {@link FixtureBoomError}.
       */
      toString(): string {
        throw new FixtureBoomError('inner');
      },
    };
    const inputs: unknown[] = [
      null,
      undefined,
      0,
      '',
      false,
      [],
      {},
      Symbol('x'),
      BigInt(0),
      evilToString,
    ];
    for (const input of inputs) {
      expect(() => toError(input)).not.toThrow();
    }
  });
});
