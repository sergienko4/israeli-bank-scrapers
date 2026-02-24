import { getFromSessionStorage } from './storage';

describe('getFromSessionStorage', () => {
  function createMockPage(sessionData: Record<string, string | null>) {
    return {
      evaluate: jest.fn((_fn: (...args: any[]) => any, key: string) => {
        return Promise.resolve(sessionData[key] ?? null);
      }),
    } as any;
  }

  it('returns parsed JSON for existing key', async () => {
    const page = createMockPage({ token: JSON.stringify({ access: 'abc123' }) });
    const result = await getFromSessionStorage<{ access: string }>(page, 'token');
    expect(result).toEqual({ access: 'abc123' });
  });

  it('returns null for missing key', async () => {
    const page = createMockPage({});
    const result = await getFromSessionStorage(page, 'nonexistent');
    expect(result).toBeNull();
  });

  it('returns null for empty string value', async () => {
    const page = createMockPage({ empty: '' });
    const result = await getFromSessionStorage(page, 'empty');
    expect(result).toBeNull();
  });

  it('parses array values', async () => {
    const page = createMockPage({ list: JSON.stringify([1, 2, 3]) });
    const result = await getFromSessionStorage<number[]>(page, 'list');
    expect(result).toEqual([1, 2, 3]);
  });
});
