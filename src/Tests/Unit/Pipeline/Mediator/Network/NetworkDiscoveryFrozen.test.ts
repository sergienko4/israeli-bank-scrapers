/**
 * Unit tests for createFrozenNetwork — the Page-less factory that the
 * pipeline uses when replaying captured endpoints (e.g. for offline
 * mock E2E or FrozenScrapeAction). Exercises the shared private
 * helpers: extractSpaHeaders, discoverHeaderValue, pickBestValue,
 * resolveOrigin (via extractOriginOnly), and buildDiscoveredHeaders.
 */

import {
  createFrozenNetwork,
  type IDiscoveredEndpoint,
} from '../../../../../Scrapers/Pipeline/Mediator/Network/NetworkDiscovery.js';

/**
 * Build a minimal captured-endpoint stub.
 * @param args - URL + optional headers + optional response body.
 * @param args.url - Endpoint URL.
 * @param args.method - HTTP method (default 'GET').
 * @param args.requestHeaders - Request headers captured during traffic.
 * @param args.responseBody - Parsed response body.
 * @returns Captured endpoint record.
 */
function makeEp(args: {
  url: string;
  method?: string;
  requestHeaders?: Record<string, string>;
  responseBody?: Record<string, unknown>;
}): IDiscoveredEndpoint {
  return {
    url: args.url,
    method: args.method ?? 'GET',
    status: 200,
    requestHeaders: args.requestHeaders ?? {},
    responseBody: args.responseBody ?? {},
    timestamp: Date.now(),
  } as unknown as IDiscoveredEndpoint;
}

describe('createFrozenNetwork — header methods', () => {
  it('exposes the cached auth token from cacheAuthToken + discoverAuthToken', async (): Promise<void> => {
    const net = createFrozenNetwork([], 'Bearer frozen-token');
    const fromDiscover = await net.discoverAuthToken();
    const fromCache = await net.cacheAuthToken();
    expect(fromDiscover).toBe('Bearer frozen-token');
    expect(fromCache).toBe('Bearer frozen-token');
  });

  it('returns false discoverAuthToken when cachedAuth is false', async (): Promise<void> => {
    const net = createFrozenNetwork([], false);
    const token = await net.discoverAuthToken();
    expect(token).toBe(false);
  });

  it('discoverOrigin picks the first Origin header from captured endpoints', (): void => {
    const endpoints = [
      makeEp({
        url: 'https://api.bank.example.com/v1/accounts',
        requestHeaders: { origin: 'https://bank.example.com' },
      }),
    ];
    const net = createFrozenNetwork(endpoints, false);
    const origin = net.discoverOrigin();
    expect(origin).toBe('https://bank.example.com');
  });

  it('discoverOrigin returns false when no endpoint has an Origin header', (): void => {
    const endpoints = [makeEp({ url: 'https://api.example.com/v1/x' })];
    const net = createFrozenNetwork(endpoints, false);
    const origin = net.discoverOrigin();
    expect(origin).toBe(false);
  });

  it('discoverSiteId picks the first X-Site-Id header from captured endpoints', (): void => {
    const endpoints = [
      makeEp({
        url: 'https://api.bank.example.com/v1/accounts',
        requestHeaders: { 'x-site-id': 'SITE-42' },
      }),
    ];
    const net = createFrozenNetwork(endpoints, false);
    const siteId = net.discoverSiteId();
    expect(siteId).toBe('SITE-42');
  });
});

describe('createFrozenNetwork — buildDiscoveredHeaders', () => {
  it('assembles SPA + auth + origin + referer + site-id layers', async (): Promise<void> => {
    const endpoints = [
      makeEp({
        url: 'https://api.bank.example.com/api/transactions/list?foo=bar',
        requestHeaders: {
          origin: 'https://bank.example.com',
          'x-site-id': 'SITE-777',
          'x-sid': 'SID-abc',
          'x-cid': 'CID-xyz',
          // browser-standard — must be filtered
          'user-agent': 'Mozilla/5.0',
          accept: '*/*',
        },
      }),
    ];
    const net = createFrozenNetwork(endpoints, 'Bearer FT');
    const opts = await net.buildDiscoveredHeaders();
    const h = opts.extraHeaders;
    expect(h['Content-Type']).toBe('application/json');
    expect(h.authorization).toBe('Bearer FT');
    expect(h.Origin).toBe('https://bank.example.com');
    expect(h.Referer).toBe('https://bank.example.com');
    expect(h['X-Site-Id']).toBe('SITE-777');
    // SPA custom headers propagate.
    expect(h['x-sid']).toBe('SID-abc');
    expect(h['x-cid']).toBe('CID-xyz');
    // Browser-standard excluded.
    expect(h['user-agent']).toBeUndefined();
    expect(h.accept).toBeUndefined();
  });

  it('omits auth when cachedAuth is false', async (): Promise<void> => {
    const endpoints = [
      makeEp({
        url: 'https://api.bank.example.com/api/transactions',
        requestHeaders: { origin: 'https://bank.example.com' },
      }),
    ];
    const net = createFrozenNetwork(endpoints, false);
    const opts = await net.buildDiscoveredHeaders();
    const h = opts.extraHeaders;
    expect(h.authorization).toBeUndefined();
    expect(h.Origin).toBe('https://bank.example.com');
  });

  it('omits origin/referer/siteId when no matching captured header exists', async (): Promise<void> => {
    const endpoints = [makeEp({ url: 'https://api.bank.example.com/api/transactions' })];
    const net = createFrozenNetwork(endpoints, 'tok');
    const opts = await net.buildDiscoveredHeaders();
    const h = opts.extraHeaders;
    expect(h.Origin).toBeUndefined();
    expect(h.Referer).toBeUndefined();
    expect(h['X-Site-Id']).toBeUndefined();
    expect(h.authorization).toBe('tok');
  });
});

describe('createFrozenNetwork — waitForTraffic + traffic methods', () => {
  it('waitForTraffic is a no-op that resolves false', async (): Promise<void> => {
    const net = createFrozenNetwork([], false);
    const result = await net.waitForTraffic([/anything/], 10);
    expect(result).toBe(false);
  });

  it('getAllEndpoints returns the frozen array verbatim', (): void => {
    const endpoints = [makeEp({ url: 'https://api.example.com/x' })];
    const net = createFrozenNetwork(endpoints, false);
    const returned = net.getAllEndpoints();
    expect(returned).toHaveLength(1);
    expect(returned[0].url).toBe('https://api.example.com/x');
  });
});
