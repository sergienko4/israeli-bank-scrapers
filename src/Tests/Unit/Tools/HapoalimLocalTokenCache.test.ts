/**
 * The local Hapoalim runner must not report a successful run when the token
 * cache could not be written: the next run would silently lose the device seed
 * and could cost an unnecessary OTP enrollment.
 */

import { mkdtemp, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  makeTokenSaver,
  readToken,
  TOKEN_CACHE_FAILURE,
  writeToken,
} from '../../E2eReal/Tools/HapoalimLocalTokenCache.js';

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
