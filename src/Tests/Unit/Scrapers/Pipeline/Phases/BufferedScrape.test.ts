/**
 * Unit tests for Phase 11: Buffered Scrape + Dynamic TXN Patterns.
 * Rule #9: Tests first, then code.
 */

import type { IDiscoveredEndpoint } from '../../../../../Scrapers/Pipeline/Mediator/NetworkDiscoveryTypes.js';
import { fetchDiscovered } from '../../../../../Scrapers/Pipeline/Phases/ScrapePhase.js';
import type { IApiFetchContext } from '../../../../../Scrapers/Pipeline/Types/PipelineContext.js';
import type { Procedure } from '../../../../../Scrapers/Pipeline/Types/Procedure.js';
import { succeed } from '../../../../../Scrapers/Pipeline/Types/Procedure.js';
import { buildTxnPagePatterns } from '../../../../../Scrapers/Pipeline/Types/UrlHelpers.js';

/** Whether a regex test matched. */
type RegexMatch = boolean;

// ── buildTxnPagePatterns ─────────────────────────────────

describe('buildTxnPagePatterns', () => {
  it('returns base patterns when apiBase is null', () => {
    const patterns = buildTxnPagePatterns(null);
    expect(patterns.length).toBe(4);
    const hasTransactions = patterns.some((p): RegexMatch => p.test('/transactions'));
    expect(hasTransactions).toBe(true);
    const hasList = patterns.some((p): RegexMatch => p.test('/transactionlist'));
    expect(hasList).toBe(true);
  });

  it('adds dynamic web-domain pattern for Amex', () => {
    const patterns = buildTxnPagePatterns('https://he.americanexpress.co.il');
    expect(patterns.length).toBe(5);
    const dynamic = patterns[4];
    const isFullMatch = dynamic.test('https://web.americanexpress.co.il/transactions');
    expect(isFullMatch).toBe(true);
    const isOcpMatch = dynamic.test('https://web.americanexpress.co.il/ocp/transactions');
    expect(isOcpMatch).toBe(true);
    const isOtherMatch = dynamic.test('https://web.other-bank.co.il/transactions');
    expect(isOtherMatch).toBe(false);
  });

  it('adds dynamic web-domain pattern for Isracard', () => {
    const patterns = buildTxnPagePatterns('https://digital.isracard.co.il');
    expect(patterns.length).toBe(5);
    const dynamic = patterns[4];
    const isDirectMatch = dynamic.test('https://web.isracard.co.il/transactions');
    expect(isDirectMatch).toBe(true);
    const isNestedMatch = dynamic.test('https://web.isracard.co.il/some/path/transactions');
    expect(isNestedMatch).toBe(true);
    const isCrossMatch = dynamic.test('https://web.americanexpress.co.il/transactions');
    expect(isCrossMatch).toBe(false);
  });

  it('returns base patterns for invalid URL', () => {
    const patterns = buildTxnPagePatterns('not-a-url');
    expect(patterns.length).toBe(4);
  });

  it('returns base patterns when hostname has no replaceable prefix', () => {
    const patterns = buildTxnPagePatterns('https://www.example.com');
    expect(patterns.length).toBe(4);
  });
});

// ── fetchDiscovered (buffered) ───────────────────────────

describe('fetchDiscovered/buffered', () => {
  /**
   * Build a mock endpoint with optional responseBody.
   * @param overrides - Partial endpoint fields to override.
   * @returns Mock IDiscoveredEndpoint.
   */
  function mockEndpoint(overrides: Partial<IDiscoveredEndpoint> = {}): IDiscoveredEndpoint {
    return {
      url: 'https://web.example.com/api/GetTransactions',
      method: 'POST',
      postData: '{"key":"value"}',
      responseBody: null,
      contentType: 'application/json',
      requestHeaders: {},
      timestamp: Date.now(),
      ...overrides,
    };
  }

  /**
   * Build a mock API context that tracks calls.
   * @returns Mock API with call tracking.
   */
  function mockApi(): IApiFetchContext & { readonly calls: string[] } {
    const calls: string[] = [];
    return {
      calls,
      /**
       * Mock fetchPost — records call and returns succeed.
       * @param url - URL.
       * @returns Succeed with empty object.
       */
      fetchPost: <T>(url: string): Promise<Procedure<T>> => {
        calls.push(`POST ${url}`);
        const result = succeed({} as T);
        return Promise.resolve(result);
      },
      /**
       * Mock fetchGet — records call and returns succeed.
       * @param url - URL.
       * @returns Succeed with empty object.
       */
      fetchGet: <T>(url: string): Promise<Procedure<T>> => {
        calls.push(`GET ${url}`);
        const result = succeed({} as T);
        return Promise.resolve(result);
      },
      accountsUrl: false,
      transactionsUrl: false,
      balanceUrl: false,
      pendingUrl: false,
    };
  }

  it('uses buffered responseBody when available (zero network)', async () => {
    const txnData = { transactions: [{ amount: 100, description: 'Test' }] };
    const endpoint = mockEndpoint({ responseBody: txnData });
    const api = mockApi();

    const result = await fetchDiscovered(api, endpoint);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.value).toBe(txnData);
    }
    expect(api.calls).toHaveLength(0);
  });

  it('falls back to POST when responseBody is null', async () => {
    const endpoint = mockEndpoint({ responseBody: null });
    const api = mockApi();

    const result = await fetchDiscovered(api, endpoint);

    expect(result.success).toBe(true);
    expect(api.calls).toHaveLength(1);
    expect(api.calls[0]).toBe('POST https://web.example.com/api/GetTransactions');
  });

  it('falls back to GET when responseBody is null and method is GET', async () => {
    const endpoint = mockEndpoint({ method: 'GET', responseBody: null });
    const api = mockApi();

    const result = await fetchDiscovered(api, endpoint);

    expect(result.success).toBe(true);
    expect(api.calls).toHaveLength(1);
    expect(api.calls[0]).toBe('GET https://web.example.com/api/GetTransactions');
  });
});
