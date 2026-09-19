/**
 * TokenCacheBankKey — proves the cache path cannot be steered outside its
 * directory by an untrusted bank key.
 *
 * <p>`cachePathFor` interpolates the key straight into a filename, so a key
 * carrying `..` escapes the cache directory entirely. Keys reach it from argv
 * (`npm run measure:token-lifetime -- <key>`), so the allowlist is the
 * boundary check, not a formality.
 */

import * as path from 'node:path';

import type { BankKey } from '../E2eReal/TokenCache.js';
import { BANK_KEYS, cachePathFor, isBankKey, requireBankKey } from '../E2eReal/TokenCache.js';

const SANDBOX = path.join(path.sep, 'tmp', 'cache-dir');

/**
 * Whether a resolved path stays inside the sandbox directory.
 * @param resolved - Path produced by cachePathFor.
 * @returns True when the path is contained by SANDBOX.
 */
function isInsideSandbox(resolved: string): boolean {
  const relative = path.relative(SANDBOX, resolved);
  return !relative.startsWith('..') && !path.isAbsolute(relative);
}

/** A key the guard must refuse, paired with the reason it is dangerous. */
interface IRejectedKey {
  readonly key: string;
  readonly why: string;
}

/**
 * Keys that must never become a path. The traversal entries are the ones the
 * guard exists for; the rest keep the allowlist from widening by accident.
 */
const REJECTED_KEYS: readonly IRejectedKey[] = [
  { key: '../../../evil', why: 'a key that climbs out of the cache directory' },
  { key: '../onezero', why: 'a key carrying a single parent segment' },
  { key: '/etc/onezero', why: 'an absolute path posing as a key' },
  { key: 'hapoalim', why: 'a bank that is not supported' },
  { key: '', why: 'the empty string' },
];

describe('isBankKey', () => {
  it.each(BANK_KEYS)('accepts the supported key %s', key => {
    const wasAccepted = isBankKey(key);
    expect(wasAccepted).toBe(true);
  });

  it.each(REJECTED_KEYS)('rejects $why', ({ key }) => {
    const wasAccepted = isBankKey(key);
    expect(wasAccepted).toBe(false);
  });
});

describe('cachePathFor', () => {
  it.each(BANK_KEYS)('keeps %s inside the given directory', key => {
    const resolved = cachePathFor(key, SANDBOX);
    const wasContained = isInsideSandbox(resolved);
    expect(wasContained).toBe(true);
  });

  it('would escape the directory for a traversal key, which is why the guard exists', () => {
    const resolved = path.join(SANDBOX, '../../../evil-token.cache');
    const wasContained = isInsideSandbox(resolved);
    expect(wasContained).toBe(false);
  });
});

describe('requireBankKey — the guard the measure CLI runs before it reads anything', () => {
  it.each(BANK_KEYS)('returns %s unchanged', key => {
    const resolved = requireBankKey(key);
    expect(resolved).toBe(key);
  });

  it.each(REJECTED_KEYS)('refuses $why before touching the filesystem', ({ key }) => {
    /**
     * Invoke the guard with an argument that must never become a path.
     * @returns Never — the guard throws first.
     */
    const reject = (): BankKey => requireBankKey(key);
    expect(reject).toThrow(/usage: measure:token-lifetime/);
  });

  it('names the supported keys so the operator can correct the call', () => {
    /**
     * Invoke the guard with no argument at all.
     * @returns Never — the guard throws first.
     */
    const reject = (): BankKey => requireBankKey('');
    const supported = BANK_KEYS.join(', ');
    expect(reject).toThrow(supported);
  });
});
