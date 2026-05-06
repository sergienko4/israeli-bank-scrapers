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
