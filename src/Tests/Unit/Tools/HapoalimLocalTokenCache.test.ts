/**
 * The local Hapoalim runner must not report a successful run when the token
 * cache could not be written: the next run would silently lose the device seed
 * and could cost an unnecessary OTP enrollment.
 */

import { mkdir, mkdtemp, readdir, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import ScraperError from '../../../Scrapers/Base/ScraperError.js';
import {
  makeTokenSaver,
  readToken,
  TOKEN_CACHE_FAILURE,
  TOKEN_CACHE_PENDING,
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
    const saved = await readToken(file);
    expect(saved).toBe('syn-token-value');
    const mode = (await stat(file)).mode & 0o777;
    expect(mode).toBe(0o600);
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

  it('awaits a pending save and reports its failure', async (): Promise<void> => {
    /**
     * Reject after a short delay so the runner must await a pending save.
     * @returns Never a path; the save fails.
     */
    const writer: TokenWriter = async () => {
      await humanDelay(20, 21);
      throw new ScraperError('write failed');
    };
    const file = join(dir, 'token.cache');
    const saver = makeTokenSaver(file, writer);
    const saving = saver.save({ longTermToken: 'syn-token-value', bearer: '' });
    const failure = await saver.settle(1_000);
    await saving;
    expect(failure).toBe(TOKEN_CACHE_FAILURE);
  });

  it('fails closed when a save does not settle', async (): Promise<void> => {
    const file = join(dir, 'token.cache');
    const saver = makeTokenSaver(file, neverWriter);
    const saving = saver.save({ longTermToken: 'syn-token-value', bearer: '' });
    const failure = await saver.settle(5);
    expect(failure).toBe(TOKEN_CACHE_PENDING);
    saving.catch(() => true);
  });

  it('clears a prior failure after a successful save', async (): Promise<void> => {
    const file = join(dir, 'token.cache');
    const saver = makeTokenSaver(file);
    await saver.save({ longTermToken: 'syn-token-value', bearer: '' });
    const failure = saver.failure();
    expect(failure).toBe('');
    const saved = await readToken(file);
    expect(saved).toBe('syn-token-value');
  });

  it('does not write when the flow publishes no token', async (): Promise<void> => {
    const file = join(dir, 'token.cache');
    const saver = makeTokenSaver(file);
    await saver.save({ longTermToken: '', bearer: '' });
    const failure = saver.failure();
    expect(failure).toBe('');
    const saved = await readToken(file);
    expect(saved).toBe('');
  });
});
