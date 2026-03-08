import { jest } from '@jest/globals';

import { getFromSessionStorage } from '../../Common/Storage.js';
import { createMockPage } from '../MockPage.js';

function createSessionMockPage(
  sessionData: Record<string, string | null>,
): ReturnType<typeof createMockPage> {
  return createMockPage({
    evaluate: jest.fn((_fn: (k: string) => string | null, key: string) => {
      return Promise.resolve(sessionData[key] ?? null);
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
});
