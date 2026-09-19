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

describe('isBankKey', () => {
  it.each(BANK_KEYS)('accepts the supported key %s', key => {
    const wasAccepted = isBankKey(key);
    expect(wasAccepted).toBe(true);
  });

  it('rejects a key that climbs out of the cache directory', () => {
    const wasAccepted = isBankKey('../../../evil');
    expect(wasAccepted).toBe(false);
  });

  it('rejects a key carrying a single parent segment', () => {
    const wasAccepted = isBankKey('../onezero');
    expect(wasAccepted).toBe(false);
  });

  it('rejects an absolute path posing as a key', () => {
    const wasAccepted = isBankKey('/etc/onezero');
    expect(wasAccepted).toBe(false);
  });

  it('rejects a bank that is not supported', () => {
    const wasAccepted = isBankKey('hapoalim');
    expect(wasAccepted).toBe(false);
  });

  it('rejects the empty string', () => {
    const wasAccepted = isBankKey('');
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

  it('refuses a traversal argument instead of resolving it to a path', () => {
    /**
     * Invoke the guard with a path-climbing argument.
     * @returns Never — the guard throws first.
     */
    const reject = (): BankKey => requireBankKey('../../../evil');
    expect(reject).toThrow(/usage: measure:token-lifetime/);
  });

  it('refuses an unsupported bank instead of resolving it to a path', () => {
    /**
     * Invoke the guard with a bank the cache does not support.
     * @returns Never — the guard throws first.
     */
    const reject = (): BankKey => requireBankKey('hapoalim');
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
