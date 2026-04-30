import { BrowserFetchStrategy } from '../../../../Scrapers/Pipeline/Strategy/Fetch/BrowserFetchStrategy.js';
import { DEFAULT_FETCH_OPTS } from '../../../../Scrapers/Pipeline/Strategy/Fetch/FetchStrategy.js';
import { makeMockPage } from './MockFactories.js';

/** Shorthand for default fetch opts. */
const OPTS = DEFAULT_FETCH_OPTS;

describe('BrowserFetchStrategy/error-handling', () => {
  it('catches page.evaluate errors and returns failure', async () => {
    const page = makeMockPage();
    const strategy = new BrowserFetchStrategy(page);
    const result = await strategy.fetchPost('https://api.test/post', { key: 'val' }, OPTS);
    expect(result.success).toBe(false);
  });

  it('catches fetchGet errors and returns failure', async () => {
    const page = makeMockPage();
    const strategy = new BrowserFetchStrategy(page);
    const result = await strategy.fetchGet('https://api.test/get', OPTS);
    expect(result.success).toBe(false);
  });

  it('returns error message from caught exception', async () => {
    const page = makeMockPage();
    const strategy = new BrowserFetchStrategy(page);
    const result = await strategy.fetchPost('https://api.test', {}, OPTS);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.errorMessage.length).toBeGreaterThan(0);
    }
  });
});
