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
  /** Whether this key would read *outside* the cache directory unguarded. */
  readonly wouldEscape: boolean;
}

/**
 * Keys that must never become a path, and what each would do if it did.
 *
 * <p>Only the `..` keys leave the directory — `path.join` folds a leading
 * slash away, so an absolute key lands in a wrong *subdirectory* instead.
 * Both outcomes are wrong, which is why the guard refuses on the allowlist
 * rather than on a path-shape heuristic that would wave `/etc/onezero`
 * through.
 */
const REJECTED_KEYS: readonly IRejectedKey[] = [
  { key: '../../../evil', why: 'a key that climbs out of the cache directory', wouldEscape: true },
  { key: '../onezero', why: 'a key carrying a single parent segment', wouldEscape: true },
  { key: '/etc/onezero', why: 'an absolute path posing as a key', wouldEscape: false },
  { key: 'hapoalim', why: 'a bank that is not supported', wouldEscape: false },
  { key: '', why: 'the empty string', wouldEscape: false },
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

  it.each(REJECTED_KEYS)('resolves $why to the wrong file if the guard is bypassed', entry => {
    const unguarded = entry.key as BankKey;
    const resolved = cachePathFor(unguarded, SANDBOX);
    const wasContained = isInsideSandbox(resolved);
    expect(wasContained).toBe(!entry.wouldEscape);
    const expected = path.join(SANDBOX, `${entry.key}-token.cache`);
    expect(resolved).toBe(expected);
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
