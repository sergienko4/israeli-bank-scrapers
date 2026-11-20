/**
 * The local Hapoalim runner must not report a successful run when the token
 * cache could not be written: the next run would silently lose the device seed
 * and could cost an unnecessary OTP enrollment.
 */

import { mkdir, mkdtemp, readdir, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { jest } from '@jest/globals';

import ScraperError from '../../../Scrapers/Base/ScraperError.js';
import {
  makeTokenSaver,
  readTokenState,
  TOKEN_CACHE_FAILURE,
  TOKEN_CACHE_PENDING,
  TOKEN_NOT_PERSISTED,
  TOKEN_READ_FAILURE,
  type TokenWriter,
  writeToken,
} from '../../E2eReal/Tools/HapoalimLocalTokenCache.js';
import humanDelay from '../../Helpers/HumanDelay.js';

/**
 * A writer that never settles, for the timeout test.
 * @returns A promise that stays pending.
 */
function neverWriter(): Promise<string> {
  return new Promise<string>(() => {
    // Deliberately never settles.
  });
}

describe('Hapoalim local token cache', () => {
  let dir = '';

  beforeEach(async (): Promise<void> => {
    const base = tmpdir();
    const prefix = join(base, 'hp-token-');
    dir = await mkdtemp(prefix);
  });

  afterEach(async (): Promise<void> => {
    await rm(dir, { recursive: true, force: true });
  });

  it('writes the token owner-only and reads it back', async (): Promise<void> => {
    const file = join(dir, 'token.cache');
    await writeToken(file, 'syn-token-value');
    const saved = await readTokenState(file);
    expect(saved).toEqual({ kind: 'present', token: 'syn-token-value' });
    const mode = (await stat(file)).mode & 0o777;
    expect(mode).toBe(0o600);
  });

  it('distinguishes a missing cache from an unreadable one', async (): Promise<void> => {
    const missing = join(dir, 'missing.cache');
    const missingResult = await readTokenState(missing);
    expect(missingResult).toEqual({ kind: 'missing' });
    const unreadable = join(dir, 'unreadable.cache');
    await mkdir(unreadable);
    const errorResult = await readTokenState(unreadable);
    expect(errorResult).toEqual({ kind: 'error' });
    expect(TOKEN_READ_FAILURE).not.toContain('syn-token-value');
  });

  it('reports an unwritable cache without leaking the token', async (): Promise<void> => {
    const file = join(dir, 'missing', 'token.cache');
    const saver = makeTokenSaver(file);
    await saver.save({ longTermToken: 'syn-token-value', bearer: '' });
    const failure = saver.failure();
    expect(failure).toBe(TOKEN_CACHE_FAILURE);
    expect(failure).not.toContain('syn-token-value');
  });

  it('removes the scratch file when rename fails', async (): Promise<void> => {
    const file = join(dir, 'token.cache');
    await mkdir(file);
    const attempt = writeToken(file, 'syn-token-value');
    await expect(attempt).rejects.toThrow();
    const entries = await readdir(dir);
    const scratch = entries.filter(name => name.endsWith('.tmp'));
    expect(scratch).toEqual([]);
    expect(entries).toContain('token.cache');
  });

  it('serializes saves so an older bundle cannot finish last', async (): Promise<void> => {
    const order: string[] = [];
    /**
     * Delay the older token so an unserialized newer save would overtake it.
     * @param _file - Cache path.
     * @param token - Token to write.
     * @returns The cache path.
     */
    const writer: TokenWriter = async (_file, token) => {
      order.push(`start:${token}`);
      if (token === 'old') await humanDelay(20, 21);
      order.push(`end:${token}`);
      return _file;
    };
    const file = join(dir, 'token.cache');
    const saver = makeTokenSaver(file, writer);
    const oldSave = saver.save({ longTermToken: 'old', bearer: '' });
    const newSave = saver.save({ longTermToken: 'new', bearer: '' });
    await Promise.all([oldSave, newSave]);
    expect(order).toEqual(['start:old', 'end:old', 'start:new', 'end:new']);
  });

  it('recovers after a failed save and satisfies a required token', async (): Promise<void> => {
    let attempts = 0;
    /**
     * Reject the first save after a delay, then accept the second.
     * @param cacheFile - Cache path.
     * @returns The cache path on success.
     */
    const writer: TokenWriter = async cacheFile => {
      attempts += 1;
      if (attempts === 1) {
        await humanDelay(20, 21);
        throw new ScraperError('write failed');
      }
      return cacheFile;
    };
    const file = join(dir, 'token.cache');
    const saver = makeTokenSaver(file, writer);
    const firstSave = saver.save({ longTermToken: 'first', bearer: '' });
    const firstFailure = await saver.settle(1_000, true);
    await firstSave;
    expect(firstFailure).toBe(TOKEN_CACHE_FAILURE);
    const secondSave = saver.save({ longTermToken: 'second', bearer: '' });
    await secondSave;
    const secondFailure = await saver.settle(5, true);
    const finalFailure = saver.failure();
    expect(secondFailure).toBe('');
    expect(finalFailure).toBe('');
    const didSave = saver.hasSaved();
    expect(didSave).toBe(true);
  });

  it('fails closed when a cold success publishes no token', async (): Promise<void> => {
    const file = join(dir, 'token.cache');
    const saver = makeTokenSaver(file);
    const failure = await saver.settle(5, true);
    expect(failure).toBe(TOKEN_NOT_PERSISTED);
    const didSave = saver.hasSaved();
    expect(didSave).toBe(false);
  });

  it('fails closed when a save does not settle', async (): Promise<void> => {
    const file = join(dir, 'token.cache');
    const saver = makeTokenSaver(file, neverWriter);
    const saving = saver.save({ longTermToken: 'syn-token-value', bearer: '' });
    const failure = await saver.settle(5);
    expect(failure).toBe(TOKEN_CACHE_PENDING);
    saving.catch(() => true);
  });

  it('clears the settle timer when the queue is already empty', async (): Promise<void> => {
    jest.useFakeTimers();
    try {
      const file = join(dir, 'token.cache');
      const saver = makeTokenSaver(file);
      const failure = await saver.settle(5_000);
      expect(failure).toBe('');
      const timerCount = jest.getTimerCount();
      expect(timerCount).toBe(0);
    } finally {
      jest.useRealTimers();
    }
  });

  it('clears a prior failure after a successful save', async (): Promise<void> => {
    const file = join(dir, 'token.cache');
    const saver = makeTokenSaver(file);
    await saver.save({ longTermToken: 'syn-token-value', bearer: '' });
    const failure = saver.failure();
    expect(failure).toBe('');
    const saved = await readTokenState(file);
    expect(saved).toEqual({ kind: 'present', token: 'syn-token-value' });
    const requiredFailure = await saver.settle(5, true);
    expect(requiredFailure).toBe('');
    const didSave = saver.hasSaved();
    expect(didSave).toBe(true);
  });

  it('does not write when the flow publishes no token', async (): Promise<void> => {
    const file = join(dir, 'token.cache');
    const saver = makeTokenSaver(file);
    await saver.save({ longTermToken: '', bearer: '' });
    const failure = saver.failure();
    expect(failure).toBe('');
    const saved = await readTokenState(file);
    expect(saved).toEqual({ kind: 'missing' });
  });
});
