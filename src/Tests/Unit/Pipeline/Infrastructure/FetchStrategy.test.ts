import { BrowserFetchStrategy } from '../../../../Scrapers/Pipeline/Strategy/BrowserFetchStrategy.js';
import { GraphQLFetchStrategy } from '../../../../Scrapers/Pipeline/Strategy/GraphQLFetchStrategy.js';
import { NativeFetchStrategy } from '../../../../Scrapers/Pipeline/Strategy/NativeFetchStrategy.js';

/** Minimal mock Page for BrowserFetchStrategy constructor. */
const MOCK_PAGE = {
  /**
   * Stub url method.
   * @returns Stub URL string.
   */
  url: () => 'https://bank.example.com/login',
} as never;

describe('BrowserFetchStrategy/fetchPost', () => {
  it('returns failure Procedure (stub)', async () => {
    const strategy = new BrowserFetchStrategy(MOCK_PAGE);
    const result = await strategy.fetchPost('https://api.test/post', { key: 'val' });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errorMessage).toContain('stub');
      expect(result.errorMessage).toContain('POST');
    }
  });

  it('includes URL in error message', async () => {
    const strategy = new BrowserFetchStrategy(MOCK_PAGE);
    const result = await strategy.fetchPost('https://api.test/endpoint', {});
    if (!result.ok) {
      expect(result.errorMessage).toContain('https://api.test/endpoint');
    }
  });

  it('includes data key count in error message', async () => {
    const strategy = new BrowserFetchStrategy(MOCK_PAGE);
    const result = await strategy.fetchPost('https://api.test', { a: '1', b: '2' });
    if (!result.ok) {
      expect(result.errorMessage).toContain('2 keys');
    }
  });
});

describe('BrowserFetchStrategy/fetchGet', () => {
  it('returns failure Procedure (stub)', async () => {
    const strategy = new BrowserFetchStrategy(MOCK_PAGE);
    const result = await strategy.fetchGet('https://api.test/get');
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errorMessage).toContain('stub');
      expect(result.errorMessage).toContain('GET');
    }
  });

  it('includes page URL in error message', async () => {
    const strategy = new BrowserFetchStrategy(MOCK_PAGE);
    const result = await strategy.fetchGet('https://api.test');
    if (!result.ok) {
      expect(result.errorMessage).toContain('bank.example.com');
    }
  });
});

describe('NativeFetchStrategy/fetchPost', () => {
  it('returns failure Procedure (stub)', async () => {
    const strategy = new NativeFetchStrategy('https://api.base');
    const result = await strategy.fetchPost('https://api.base/login', { user: 'test' });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errorMessage).toContain('stub');
    }
  });

  it('includes base URL in error message', async () => {
    const strategy = new NativeFetchStrategy('https://my-api.com');
    const result = await strategy.fetchPost('https://my-api.com/auth', {});
    if (!result.ok) {
      expect(result.errorMessage).toContain('my-api.com');
    }
  });
});

describe('NativeFetchStrategy/fetchGet', () => {
  it('returns failure Procedure (stub)', async () => {
    const strategy = new NativeFetchStrategy('https://api.base');
    const result = await strategy.fetchGet('https://api.base/data');
    expect(result.ok).toBe(false);
  });
});

describe('GraphQLFetchStrategy/query', () => {
  it('returns failure Procedure (stub)', async () => {
    const strategy = new GraphQLFetchStrategy('https://gql.example.com');
    const result = await strategy.query('query { user { name } }', { id: '1' });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errorMessage).toContain('stub');
      expect(result.errorMessage).toContain('query');
    }
  });

  it('includes query preview in error message', async () => {
    const strategy = new GraphQLFetchStrategy('https://gql.example.com');
    const longQuery =
      'query GetTransactions($from: Date!) { transactions(from: $from) { id amount } }';
    const result = await strategy.query(longQuery, { from: '2024-01-01' });
    if (!result.ok) {
      expect(result.errorMessage).toContain('GetTransactions');
    }
  });

  it('includes variable count in error message', async () => {
    const strategy = new GraphQLFetchStrategy('https://gql.example.com');
    const result = await strategy.query('query { x }', { a: '1', b: '2', c: '3' });
    if (!result.ok) {
      expect(result.errorMessage).toContain('3 vars');
    }
  });

  it('inherits fetchPost and fetchGet from NativeFetchStrategy', async () => {
    const strategy = new GraphQLFetchStrategy('https://gql.example.com');
    const postResult = await strategy.fetchPost('https://url', {});
    const getResult = await strategy.fetchGet('https://url');
    expect(postResult.ok).toBe(false);
    expect(getResult.ok).toBe(false);
  });
});
