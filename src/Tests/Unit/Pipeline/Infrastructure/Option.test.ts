import { isSome, none, some, unwrapOr } from '../../../../Scrapers/Pipeline/Types/Option.js';

describe('Option/some', () => {
  it('creates a Some with has=true and the value', () => {
    const opt = some('hello');
    expect(opt.has).toBe(true);
    expect(opt.value).toBe('hello');
  });

  it('preserves numeric values', () => {
    const opt = some(42);
    expect(opt.has).toBe(true);
    expect(opt.value).toBe(42);
  });

  it('wraps objects by reference', () => {
    const obj = { key: 'val' };
    const opt = some(obj);
    expect(opt.has).toBe(true);
    expect(opt.value).toBe(obj);
  });

  it('wraps empty string as present', () => {
    const opt = some('');
    expect(opt.has).toBe(true);
    expect(opt.value).toBe('');
  });

  it('wraps zero as present', () => {
    const opt = some(0);
    expect(opt.has).toBe(true);
    expect(opt.value).toBe(0);
  });

  it('wraps false as present', () => {
    const opt = some(false);
    expect(opt.has).toBe(true);
    expect(opt.value).toBe(false);
  });
});

describe('Option/none', () => {
  it('creates a None with has=false', () => {
    const opt = none();
    expect(opt.has).toBe(false);
  });

  it('returns the same frozen instance', () => {
    const a = none();
    const b = none();
    expect(a).toBe(b);
  });

  it('is frozen (immutable)', () => {
    const opt = none();
    const isFrozen = Object.isFrozen(opt);
    expect(isFrozen).toBe(true);
  });
});

describe('Option/isSome', () => {
  it('returns true for Some', () => {
    const opt = some('value');
    const hasValue = isSome(opt);
    expect(hasValue).toBe(true);
  });

  it('returns false for None', () => {
    const opt = none();
    const hasValue = isSome(opt);
    expect(hasValue).toBe(false);
  });

  it('narrows type so value is accessible', () => {
    const opt = some(99);
    if (isSome(opt)) {
      expect(opt.value).toBe(99);
    }
  });
});

describe('Option/unwrapOr', () => {
  it('returns value when Some', () => {
    const opt = some('present');
    const result = unwrapOr(opt, 'default');
    expect(result).toBe('present');
  });

  it('returns fallback when None', () => {
    const opt = none();
    const result = unwrapOr(opt, 'default');
    expect(result).toBe('default');
  });

  it('returns empty string from Some (not fallback)', () => {
    const opt = some('');
    const result = unwrapOr(opt, 'fallback');
    expect(result).toBe('');
  });

  it('returns zero from Some (not fallback)', () => {
    const opt = some(0);
    const result = unwrapOr(opt, 999);
    expect(result).toBe(0);
  });
});
