import { getFromSessionStorage } from '../../Common/Storage';
import { createMockPage } from '../MockPage';

/**
 * Creates a mock page that returns session storage data from the given map.
 *
 * @param sessionData - a map of session storage keys to their string values
 * @returns a mock page configured to return the given session data
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
    expect(result.hasValue).toBe(true);
    if (result.hasValue) expect(result.value).toEqual({ access: 'abc123' });
  });

  it('returns hasValue: false for missing key', async () => {
    const page = createSessionMockPage({});
    const result = await getFromSessionStorage(page, 'nonexistent');
    expect(result.hasValue).toBe(false);
  });

  it('returns hasValue: false for empty string value', async () => {
    const page = createSessionMockPage({ empty: '' });
    const result = await getFromSessionStorage(page, 'empty');
    expect(result.hasValue).toBe(false);
  });

  it('parses array values', async () => {
    const page = createSessionMockPage({ list: JSON.stringify([1, 2, 3]) });
    const result = await getFromSessionStorage<number[]>(page, 'list');
    expect(result.hasValue).toBe(true);
    if (result.hasValue) expect(result.value).toEqual([1, 2, 3]);
  });
});
