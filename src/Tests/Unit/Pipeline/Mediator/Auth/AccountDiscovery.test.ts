/**
 * Coverage for `discoverAccountsInPool` — the strict pre-nav-only
 * account discoverer used by LOGIN.FINAL / OTP-FILL.FINAL.
 *
 * Each branch is exercised explicitly:
 * - Null body, non-object body, scalar body → no match.
 * - Named container hit (cards / accounts / bankAccounts) → tier 1.
 * - Root-array account-shape (Hapoalim) → tier 3 (with looksLikeAccount).
 * - Root-array WITHOUT account-shape → no match (false-positive guard).
 * - Empty pool → no match.
 */

import { discoverAccountsInPool } from '../../../../../Scrapers/Pipeline/Mediator/Auth/AccountDiscovery.js';
import type { IDiscoveredEndpoint } from '../../../../../Scrapers/Pipeline/Mediator/Network/NetworkDiscoveryTypes.js';

/**
 * Build a synthetic capture endpoint with optional method/url/body.
 * @param body - Response body to attach.
 * @returns Synthetic endpoint.
 */
function ep(body: unknown): IDiscoveredEndpoint {
  return {
    url: 'https://test.example/api/x',
    method: 'GET',
    postData: '',
    responseBody: body,
    contentType: 'application/json',
    requestHeaders: {},
    responseHeaders: {},
    timestamp: 0,
  };
}

describe('discoverAccountsInPool', () => {
  it('returns empty result for empty pool', () => {
    const result = discoverAccountsInPool([]);
    expect(result.endpoint).toBe(false);
    expect(result.ids.length).toBe(0);
    expect(result.records.length).toBe(0);
  });

  it('returns empty result when no body has account shape', () => {
    const pool = [ep({ unrelated: 1 }), ep({ transactions: [{ id: 1 }] })];
    const result = discoverAccountsInPool(pool);
    expect(result.endpoint).toBe(false);
  });

  it('skips captures with null body', () => {
    const pool = [ep(null), ep({ accounts: [{ accountId: 'A1' }] })];
    const result = discoverAccountsInPool(pool);
    expect(result.endpoint).not.toBe(false);
    expect(result.ids.length).toBeGreaterThan(0);
  });

  it('skips captures with scalar (non-object, non-array) body', () => {
    const pool = [ep('a string body'), ep(42), ep({ cards: [{ cardUniqueId: 'C1' }] })];
    const result = discoverAccountsInPool(pool);
    expect(result.endpoint).not.toBe(false);
  });

  it('matches via named container `cards`', () => {
    const pool = [ep({ cards: [{ cardUniqueId: 'C1' }] })];
    const result = discoverAccountsInPool(pool);
    expect(result.endpoint).not.toBe(false);
    expect(result.ids).toContain('C1');
  });

  it('matches via named container `bankAccounts`', () => {
    const pool = [ep({ bankAccounts: [{ accountNumber: 'BA-1' }] })];
    const result = discoverAccountsInPool(pool);
    expect(result.endpoint).not.toBe(false);
  });

  it('matches via root-array account-shape (Hapoalim shape)', () => {
    const pool = [ep([{ accountNumber: '12-34-5678', bankNumber: '12' }])];
    const result = discoverAccountsInPool(pool);
    expect(result.endpoint).not.toBe(false);
  });

  it('does NOT match a root array of objects without account-shape fields', () => {
    // Plain array with no accountId-like field on the first element.
    const pool = [ep([{ foo: 'bar' }])];
    const result = discoverAccountsInPool(pool);
    expect(result.endpoint).toBe(false);
  });

  it('does NOT match a root array whose first element is null', () => {
    const pool = [ep([null])];
    const result = discoverAccountsInPool(pool);
    expect(result.endpoint).toBe(false);
  });

  it('does NOT match an empty root array', () => {
    const pool = [ep([])];
    const result = discoverAccountsInPool(pool);
    expect(result.endpoint).toBe(false);
  });

  it('prefers named-container hit over root-array hit (tier ordering)', () => {
    const named = ep({ cards: [{ cardUniqueId: 'NAMED-1' }] });
    const rootArr = ep([{ accountNumber: 'ROOT-1' }]);
    const result = discoverAccountsInPool([rootArr, named]);
    // Named-container wins regardless of pool order.
    expect(result.endpoint).toBe(named);
  });
});

describe('request-side extraction (method-specific)', () => {
  it('extracts accountId from a GET URL query (Hapoalim shape)', () => {
    const cap: IDiscoveredEndpoint = {
      url: 'https://x.example/api/data?accountId=12-345-678&extra=x',
      method: 'GET',
      postData: '',
      responseBody: { metadata: 1 },
      contentType: 'application/json',
      requestHeaders: {},
      responseHeaders: {},
      timestamp: 0,
    };
    const result = discoverAccountsInPool([cap]);
    expect(result.ids).toContain('12-345-678');
  });

  it('extracts a numeric request-side id and coerces to string', () => {
    const cap: IDiscoveredEndpoint = {
      url: 'https://x.example/api/data?accountId=987654',
      method: 'GET',
      postData: '',
      responseBody: { unrelated: 1 },
      contentType: 'application/json',
      requestHeaders: {},
      responseHeaders: {},
      timestamp: 0,
    };
    const result = discoverAccountsInPool([cap]);
    expect(result.ids).toContain('987654');
  });

  it('returns empty when GET URL is malformed (URL constructor throws)', () => {
    const cap: IDiscoveredEndpoint = {
      url: 'not a url at all',
      method: 'GET',
      postData: '',
      responseBody: { unrelated: 1 },
      contentType: 'application/json',
      requestHeaders: {},
      responseHeaders: {},
      timestamp: 0,
    };
    const result = discoverAccountsInPool([cap]);
    expect(result.endpoint).toBe(false);
  });

  it('extracts accountId from POST postData when no body container', () => {
    const cap: IDiscoveredEndpoint = {
      url: 'https://x.example/api/transactions',
      method: 'POST',
      postData: '{"cardUniqueId":"FAKE-CARD","extra":"meta"}',
      responseBody: { transactions: [] },
      contentType: 'application/json',
      requestHeaders: {},
      responseHeaders: {},
      timestamp: 0,
    };
    const result = discoverAccountsInPool([cap]);
    expect(result.ids).toContain('FAKE-CARD');
  });

  it('returns empty when POST postData is empty string', () => {
    const cap: IDiscoveredEndpoint = {
      url: 'https://x.example/api/x',
      method: 'POST',
      postData: '',
      responseBody: { unrelated: 1 },
      contentType: 'application/json',
      requestHeaders: {},
      responseHeaders: {},
      timestamp: 0,
    };
    const result = discoverAccountsInPool([cap]);
    expect(result.endpoint).toBe(false);
  });

  it('returns empty when POST postData is invalid JSON', () => {
    const cap: IDiscoveredEndpoint = {
      url: 'https://x.example/api/x',
      method: 'POST',
      postData: 'not-json{{{',
      responseBody: { unrelated: 1 },
      contentType: 'application/json',
      requestHeaders: {},
      responseHeaders: {},
      timestamp: 0,
    };
    const result = discoverAccountsInPool([cap]);
    expect(result.endpoint).toBe(false);
  });

  it('returns empty when POST postData is a JSON number scalar', () => {
    const cap: IDiscoveredEndpoint = {
      url: 'https://x.example/api/x',
      method: 'POST',
      postData: '42',
      responseBody: { unrelated: 1 },
      contentType: 'application/json',
      requestHeaders: {},
      responseHeaders: {},
      timestamp: 0,
    };
    const result = discoverAccountsInPool([cap]);
    expect(result.endpoint).toBe(false);
  });

  it('returns empty when POST postData is a JSON array (no field-value lookup possible)', () => {
    const cap: IDiscoveredEndpoint = {
      url: 'https://x.example/api/x',
      method: 'POST',
      postData: '[{"cardUniqueId":"X"}]',
      responseBody: { unrelated: 1 },
      contentType: 'application/json',
      requestHeaders: {},
      responseHeaders: {},
      timestamp: 0,
    };
    const result = discoverAccountsInPool([cap]);
    expect(result.endpoint).toBe(false);
  });

  it('returns empty when POST postData is JSON null', () => {
    const cap: IDiscoveredEndpoint = {
      url: 'https://x.example/api/x',
      method: 'POST',
      postData: 'null',
      responseBody: { unrelated: 1 },
      contentType: 'application/json',
      requestHeaders: {},
      responseHeaders: {},
      timestamp: 0,
    };
    const result = discoverAccountsInPool([cap]);
    expect(result.endpoint).toBe(false);
  });

  it('returns empty when GET URL query has accountId="" (empty string coerces to false)', () => {
    // Hits `asAccountId`'s falsy branch — the field is present in the
    // URL but the value is empty, which must NOT be surfaced as an id.
    const cap: IDiscoveredEndpoint = {
      url: 'https://x.example/api/data?accountId=',
      method: 'GET',
      postData: '',
      responseBody: { unrelated: 1 },
      contentType: 'application/json',
      requestHeaders: {},
      responseHeaders: {},
      timestamp: 0,
    };
    const result = discoverAccountsInPool([cap]);
    expect(result.endpoint).toBe(false);
  });

  it('returns empty for PUT capture (method neither GET nor POST)', () => {
    const cap = {
      url: 'https://x.example/api/x?accountId=xxx',
      method: 'PUT',
      postData: '',
      responseBody: { unrelated: 1 },
      contentType: 'application/json',
      requestHeaders: {},
      responseHeaders: {},
      timestamp: 0,
    } as unknown as IDiscoveredEndpoint;
    const result = discoverAccountsInPool([cap]);
    expect(result.endpoint).toBe(false);
  });

  it('prefers body match over request-side extraction', () => {
    const both: IDiscoveredEndpoint = {
      url: 'https://x.example/api/x?accountId=URL-FAKE',
      method: 'GET',
      postData: '',
      responseBody: { cards: [{ cardUniqueId: 'BODY-FAKE' }] },
      contentType: 'application/json',
      requestHeaders: {},
      responseHeaders: {},
      timestamp: 0,
    };
    const result = discoverAccountsInPool([both]);
    expect(result.ids).toContain('BODY-FAKE');
    expect(result.ids).not.toContain('URL-FAKE');
  });
});
