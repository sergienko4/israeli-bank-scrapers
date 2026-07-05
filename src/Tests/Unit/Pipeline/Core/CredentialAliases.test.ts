/**
 * CredentialAliases — legacy credential-key backward-compat.
 *
 * <p>Proves `normalizeCredentials` maps a renamed field's legacy key onto
 * its canonical key (Yahav's `username` → `num`) so pre-existing callers
 * keep working, without overriding an explicitly-supplied canonical key.
 *
 * Every value is fabricated — no real credentials appear.
 */

import { normalizeCredentials } from '../../../../Scrapers/Pipeline/Core/CredentialAliases.js';

/** Plain string record view of a normalized credential bag. */
type Bag = Record<string, string>;

describe('normalizeCredentials — legacy key backward-compat', () => {
  it('maps Yahav legacy username → num when num is absent', () => {
    const out = normalizeCredentials({ username: 'U', nationalID: 'Z', password: 'P' }) as Bag;
    expect(out.num).toBe('U');
  });

  it('keeps an explicit num (alias never overrides it)', () => {
    const out = normalizeCredentials({ num: 'N', nationalID: 'Z', password: 'P' }) as Bag;
    expect(out.num).toBe('N');
  });

  it('preserves every supplied key', () => {
    const out = normalizeCredentials({ username: 'U', nationalID: 'Z', password: 'P' }) as Bag;
    expect(out.username).toBe('U');
    expect(out.nationalID).toBe('Z');
    expect(out.password).toBe('P');
  });

  it('leaves a bank with neither num nor username untouched', () => {
    const out = normalizeCredentials({ id: 'X', password: 'P' }) as Bag;
    expect('num' in out).toBe(false);
  });

  it('adds an inert num alias for a username-only bank (never read there)', () => {
    // A username-bank (e.g. Leumi) gets a `num` copy, but its login config
    // has no `num` field, so the extra key is never consulted — provably inert.
    const out = normalizeCredentials({ username: 'U', password: 'P' }) as Bag;
    expect(out.num).toBe('U');
    expect(out.username).toBe('U');
  });
});
