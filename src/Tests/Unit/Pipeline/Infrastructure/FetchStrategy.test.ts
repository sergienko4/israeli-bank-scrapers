import { BrowserFetchStrategy } from '../../../../Scrapers/Pipeline/Strategy/BrowserFetchStrategy.js';
import { GraphQLFetchStrategy } from '../../../../Scrapers/Pipeline/Strategy/GraphQLFetchStrategy.js';
import { NativeFetchStrategy } from '../../../../Scrapers/Pipeline/Strategy/NativeFetchStrategy.js';
import { makeMockPage } from './MockFactories.js';

describe('BrowserFetchStrategy/error-handling', () => {
  it('catches page.evaluate errors and returns failure', async () => {
    const page = makeMockPage();
    const strategy = new BrowserFetchStrategy(page);
    const result = await strategy.fetchPost('https://api.test/post', { key: 'val' });
    expect(result.ok).toBe(false);
  });

  it('catches fetchGet errors and returns failure', async () => {
    const page = makeMockPage();
    const strategy = new BrowserFetchStrategy(page);
    const result = await strategy.fetchGet('https://api.test/get');
    expect(result.ok).toBe(false);
  });

  it('returns error message from caught exception', async () => {
    const page = makeMockPage();
    const strategy = new BrowserFetchStrategy(page);
    const result = await strategy.fetchPost('https://api.test', {});
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errorMessage.length).toBeGreaterThan(0);
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
    expect(result.ok).toBe(false);
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
    const longQuery = 'query GetTransactions($from: Date!) { transactions(from: $from) { id } }';
    const result = await strategy.query(longQuery, { from: '2024-01-01' });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errorMessage).toContain('GetTransactions');
    }
  });

  it('includes variable count in error message', async () => {
    const strategy = new GraphQLFetchStrategy('https://gql.example.com');
    const result = await strategy.query('query { x }', { a: '1', b: '2', c: '3' });
    expect(result.ok).toBe(false);
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
