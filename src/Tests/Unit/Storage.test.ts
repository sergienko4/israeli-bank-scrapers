import { jest } from '@jest/globals';

import { getFromSessionStorage } from '../../Common/Storage.js';
import { createMockPage } from '../MockPage.js';

/**
 * Creates a mock page with sessionStorage data for testing.
 * @param sessionData - map of session storage keys to values
 * @returns a mock page with evaluate stub for session storage
 */
function createSessionMockPage(
  sessionData: Record<string, string>,
): ReturnType<typeof createMockPage> {
  return createMockPage({
    evaluate: jest.fn((_fn: (k: string) => string, key: string) => {
      return Promise.resolve(sessionData[key] ?? '');
    }),
  });
}

describe('getFromSessionStorage', () => {
  it('returns parsed JSON for existing key', async () => {
    const page = createSessionMockPage({ token: JSON.stringify({ access: 'abc123' }) });
    const result = await getFromSessionStorage<{ access: string }>(page, 'token');
    expect(result).toEqual({ access: 'abc123' });
  });

  it('returns null for missing key', async () => {
    const page = createSessionMockPage({});
    const result = await getFromSessionStorage(page, 'nonexistent');
    expect(result).toBeNull();
  });

  it('returns null for empty string value', async () => {
    const page = createSessionMockPage({ empty: '' });
    const result = await getFromSessionStorage(page, 'empty');
    expect(result).toBeNull();
  });

  it('parses array values', async () => {
    const page = createSessionMockPage({ list: JSON.stringify([1, 2, 3]) });
    const result = await getFromSessionStorage<number[]>(page, 'list');
    expect(result).toEqual([1, 2, 3]);
  });

  it('returns null when evaluate returns null', async () => {
    const page = createMockPage({
      evaluate: jest.fn().mockResolvedValue(null),
    });
    const result = await getFromSessionStorage(page, 'missing');
    expect(result).toBeNull();
  });

  it('returns null when evaluate throws an error', async () => {
    const page = createMockPage({
      evaluate: jest.fn().mockRejectedValue(new Error('context destroyed')),
    });
    const result = await getFromSessionStorage(page, 'key');
    expect(result).toBeNull();
  });

  it('returns null when JSON.parse fails on invalid JSON', async () => {
    const page = createMockPage({
      evaluate: jest.fn().mockResolvedValue('not-valid-json{'),
    });
    const result = await getFromSessionStorage(page, 'broken');
    expect(result).toBeNull();
  });
});
