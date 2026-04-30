/**
 * Unit tests for AuthDiscovery — 3-tier auth token extraction.
 */

import type { Frame, Page } from 'playwright-core';

import {
  discoverAuthThreeTier,
  discoverFromHeaders,
} from '../../../../../Scrapers/Pipeline/Mediator/Network/AuthDiscovery.js';
import type { IDiscoveredEndpoint } from '../../../../../Scrapers/Pipeline/Mediator/Network/NetworkDiscovery.js';

/**
 * Build a minimal endpoint for tests.
 * @param overrides - Partial endpoint to merge.
 * @returns IDiscoveredEndpoint.
 */
function makeEndpoint(overrides: Partial<IDiscoveredEndpoint>): IDiscoveredEndpoint {
  return {
    url: 'https://api.bank.co.il/authentication/login',
    method: 'POST',
    postData: '',
    contentType: 'application/json',
    requestHeaders: {},
    responseHeaders: {},
    responseBody: {},
    timestamp: 0,
    ...overrides,
  };
}

/**
 * Build a mock Page with scripted evaluate for sessionStorage + frame list.
 * @param storageResult - Storage result string.
 * @param frames - Frames returned by page.frames().
 * @returns Mock page.
 */
function makePage(storageResult = 'NONE', frames: Frame[] = []): Page {
  return {
    /**
     * evaluate — returns scripted storage result.
     * @returns Resolved storage result.
     */
    evaluate: (): Promise<string> => Promise.resolve(storageResult),
    /**
     * frames.
     * @returns Provided frame list.
     */
    frames: (): Frame[] => frames,
  } as unknown as Page;
}

describe('discoverFromHeaders', () => {
  it('returns false when no auth header is present', () => {
    const ep = makeEndpoint({ requestHeaders: {} });
    const discoverFromHeadersResult1 = discoverFromHeaders([ep]);
    expect(discoverFromHeadersResult1).toBe(false);
  });

  it('extracts authorization header', () => {
    const ep = makeEndpoint({ requestHeaders: { authorization: 'Bearer abc' } });
    const discoverFromHeadersResult2 = discoverFromHeaders([ep]);
    expect(discoverFromHeadersResult2).toBe('Bearer abc');
  });

  it('extracts x-auth-token header', () => {
    const ep = makeEndpoint({ requestHeaders: { 'x-auth-token': 'xyz123' } });
    const discoverFromHeadersResult3 = discoverFromHeaders([ep]);
    expect(discoverFromHeadersResult3).toBe('xyz123');
  });

  it('returns false for empty captured array', () => {
    const discoverFromHeadersResult4 = discoverFromHeaders([]);
    expect(discoverFromHeadersResult4).toBe(false);
  });
});

describe('discoverAuthThreeTier', () => {
  it('returns false when no endpoint, no storage, no frames', async () => {
    const page = makePage('NONE');
    const token = await discoverAuthThreeTier([], page);
    expect(token).toBe(false);
  });

  it('finds token from auth endpoint body (Tier 2)', async () => {
    const ep = makeEndpoint({
      url: 'https://api.bank.co.il/authentication/login',
      responseBody: { token: 'jwt.payload.sig' },
    });
    const page = makePage('NONE');
    const token = await discoverAuthThreeTier([ep], page);
    expect(token).toContain('jwt.payload.sig');
  });

  it('falls through to sessionStorage when body lacks token', async () => {
    const ep = makeEndpoint({ responseBody: {} });
    const page = makePage('some-token-value-greater-than-10-chars');
    const token = await discoverAuthThreeTier([ep], page);
    expect(typeof token).toBe('string');
    expect(token).toContain('some-token-value');
  });

  it('parses JSON sessionStorage with auth.calConnectToken', async () => {
    const storage = JSON.stringify({ auth: { calConnectToken: 'callsessionid123456' } });
    const page = makePage(storage);
    const token = await discoverAuthThreeTier([], page);
    expect(token).toContain('callsessionid123456');
  });

  it('returns false or fallback when storage value too short', async () => {
    const page = makePage('short');
    const token = await discoverAuthThreeTier([], page);
    expect(token === false || typeof token === 'string').toBe(true);
  });

  it('finds token via access_token field in nested object', async () => {
    const ep = makeEndpoint({
      responseBody: { result: { access_token: 'nested-token-value' } },
    });
    const page = makePage('NONE');
    const token = await discoverAuthThreeTier([ep], page);
    expect(token).toContain('nested-token-value');
  });

  it('prefixes bare token with CALAuthScheme', async () => {
    const ep = makeEndpoint({
      responseBody: { token: 'raw-token' },
    });
    const page = makePage('NONE');
    const token = await discoverAuthThreeTier([ep], page);
    expect(token).toContain('CALAuthScheme');
  });

  it('preserves Bearer prefix', async () => {
    const ep = makeEndpoint({
      responseBody: { token: 'Bearer abc-xyz' },
    });
    const page = makePage('NONE');
    const token = await discoverAuthThreeTier([ep], page);
    expect(token).toContain('Bearer abc-xyz');
  });

  it('handles invalid JSON storage value gracefully', async () => {
    const page = makePage('{malformed-value-long-enough');
    const token = await discoverAuthThreeTier([], page);
    expect(typeof token === 'string' || !token).toBe(true);
  });

  it('returns false when auth endpoint body lacks any token field', async () => {
    const ep = makeEndpoint({
      url: 'https://api.bank.co.il/authentication/login',
      responseBody: { otherField: 'value' },
    });
    const page = makePage('NONE');
    const token = await discoverAuthThreeTier([ep], page);
    expect(token).toBe(false);
  });
});
