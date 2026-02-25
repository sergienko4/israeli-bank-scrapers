import { fetchGet, fetchPost, fetchGraphql, fetchGetWithinPage, fetchPostWithinPage } from './fetch';
import { createMockPage } from '../tests/mock-page';

const mockFetch = jest.fn();
const originalFetch = global.fetch;

beforeAll(() => {
  global.fetch = mockFetch;
});

afterAll(() => {
  global.fetch = originalFetch;
});

describe('fetchGet', () => {
  beforeEach(() => {
    mockFetch.mockReset();
  });

  it('sends GET request with JSON headers', async () => {
    mockFetch.mockResolvedValue({ status: 200, json: () => Promise.resolve({ data: 'test' }) });
    const result = await fetchGet('https://api.bank.co.il/data', {});
    expect(result).toEqual({ data: 'test' });
    expect(mockFetch).toHaveBeenCalledWith('https://api.bank.co.il/data', expect.objectContaining({ method: 'GET' }));
  });

  it('merges extra headers', async () => {
    mockFetch.mockResolvedValue({ status: 200, json: () => Promise.resolve({}) });
    await fetchGet('https://api.bank.co.il/data', { Authorization: 'Bearer token' });
    const callArgs = mockFetch.mock.calls[0][1];
    expect(callArgs.headers.Authorization).toBe('Bearer token');
    expect(callArgs.headers.Accept).toBe('application/json');
  });

  it('throws when status is not 200', async () => {
    mockFetch.mockResolvedValue({ status: 500, json: () => Promise.resolve({}) });
    await expect(fetchGet('https://api.bank.co.il/data', {})).rejects.toThrow('status code 500');
  });
});

describe('fetchPost', () => {
  beforeEach(() => {
    mockFetch.mockReset();
  });

  it('sends POST request with JSON body', async () => {
    mockFetch.mockResolvedValue({ json: () => Promise.resolve({ success: true }) });
    const result = await fetchPost('https://api.bank.co.il/login', { user: 'test' });
    expect(result).toEqual({ success: true });
    const callArgs = mockFetch.mock.calls[0][1];
    expect(callArgs.method).toBe('POST');
    expect(callArgs.body).toBe(JSON.stringify({ user: 'test' }));
  });

  it('returns JSON even on non-200 status', async () => {
    mockFetch.mockResolvedValue({ status: 500, json: () => Promise.resolve({ error: true }) });
    const result = await fetchPost('https://api.bank.co.il/fail', {});
    expect(result).toEqual({ error: true });
  });
});

describe('fetchGraphql', () => {
  beforeEach(() => {
    mockFetch.mockReset();
  });

  it('sends GraphQL query and returns data', async () => {
    mockFetch.mockResolvedValue({ json: () => Promise.resolve({ data: { accounts: [] } }) });
    const result = await fetchGraphql('https://api.bank.co.il/graphql', '{ accounts { id } }');
    expect(result).toEqual({ accounts: [] });
  });

  it('throws when GraphQL response has errors', async () => {
    mockFetch.mockResolvedValue({
      json: () => Promise.resolve({ errors: [{ message: 'Unauthorized' }] }),
    });
    await expect(fetchGraphql('https://api.bank.co.il/graphql', 'query')).rejects.toThrow('Unauthorized');
  });

  it('sends variables in the request body', async () => {
    mockFetch.mockResolvedValue({ json: () => Promise.resolve({ data: {} }) });
    await fetchGraphql('https://api.bank.co.il/graphql', '{ accounts }', { id: '123' });
    const body = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(body.variables).toEqual({ id: '123' });
    expect(body.query).toBe('{ accounts }');
  });
});

describe('fetchGetWithinPage', () => {
  it('returns parsed JSON on success', async () => {
    const page = createMockPage({ evaluate: jest.fn().mockResolvedValue([JSON.stringify({ balance: 1000 }), 200]) });
    const result = await fetchGetWithinPage(page, 'https://bank.co.il/api/balance');
    expect(result).toEqual({ balance: 1000 });
  });

  it('returns null for 204 status', async () => {
    const page = createMockPage({ evaluate: jest.fn().mockResolvedValue([null, 204]) });
    const result = await fetchGetWithinPage(page, 'https://bank.co.il/api/empty');
    expect(result).toBeNull();
  });

  it('throws on invalid JSON when ignoreErrors is false', async () => {
    const page = createMockPage({ evaluate: jest.fn().mockResolvedValue(['not json', 200]) });
    await expect(fetchGetWithinPage(page, 'https://bank.co.il/api/bad')).rejects.toThrow('parse error');
  });

  it('returns null on invalid JSON when ignoreErrors is true', async () => {
    const page = createMockPage({ evaluate: jest.fn().mockResolvedValue(['not json', 200]) });
    const result = await fetchGetWithinPage(page, 'https://bank.co.il/api/bad', true);
    expect(result).toBeNull();
  });
});

describe('fetchPostWithinPage', () => {
  it('returns parsed JSON on success', async () => {
    const page = createMockPage({ evaluate: jest.fn().mockResolvedValue(JSON.stringify({ result: 'ok' })) });
    const result = await fetchPostWithinPage(page, 'https://bank.co.il/api/action', { key: 'value' });
    expect(result).toEqual({ result: 'ok' });
  });

  it('returns null for 204 status', async () => {
    const page = createMockPage({ evaluate: jest.fn().mockResolvedValue(null) });
    const result = await fetchPostWithinPage(page, 'https://bank.co.il/api/empty', {});
    expect(result).toBeNull();
  });

  it('throws on invalid JSON when ignoreErrors is false', async () => {
    const page = createMockPage({ evaluate: jest.fn().mockResolvedValue('invalid json') });
    await expect(fetchPostWithinPage(page, 'https://bank.co.il/api/bad', {})).rejects.toThrow('parse error');
  });

  it('returns null on invalid JSON when ignoreErrors is true', async () => {
    const page = createMockPage({ evaluate: jest.fn().mockResolvedValue('invalid json') });
    const result = await fetchPostWithinPage(page, 'https://bank.co.il/api/bad', {}, {}, true);
    expect(result).toBeNull();
  });
});
