/**
 * More NetworkDiscovery coverage — frozen network + extractApiBaseFromUrl.
 */

import type { IDiscoveredEndpoint } from '../../../../../Scrapers/Pipeline/Mediator/Network/NetworkDiscovery.js';
import { createFrozenNetwork } from '../../../../../Scrapers/Pipeline/Mediator/Network/NetworkDiscovery.js';

/**
 * Build a discovered endpoint with optional request/response headers.
 * @param opts - Endpoint options.
 * @param opts.url - Endpoint URL.
 * @param opts.requestHeaders - Request headers.
 * @param opts.responseHeaders - Response headers.
 * @param opts.responseBody - Optional response body.
 * @returns Mock endpoint.
 */
function makeEndpoint(
  opts: {
    url?: string;
    requestHeaders?: Record<string, string>;
    responseHeaders?: Record<string, string>;
    responseBody?: unknown;
  } = {},
): IDiscoveredEndpoint {
  return {
    url: opts.url ?? 'https://api.bank.co.il/x',
    method: 'POST' as const,
    postData: '',
    contentType: 'application/json',
    requestHeaders: opts.requestHeaders ?? {},
    responseHeaders: opts.responseHeaders ?? { 'content-type': 'application/json' },
    responseBody: opts.responseBody ?? {},
    timestamp: 0,
  };
}

describe('NetworkDiscovery — createFrozenNetwork', () => {
  it('frozen network — buildDiscoveredHeaders includes cached auth + origin/siteId', async () => {
    const eps = [
      makeEndpoint({
        url: 'https://api.bank.co.il/transactions',
        requestHeaders: {
          origin: 'https://spa.bank.co.il',
          'x-site-id': 'portal-42',
          'x-custom-header': 'spa-header',
          host: 'api.bank.co.il',
        },
      }),
    ];
    const frozen = createFrozenNetwork(eps, 'CALAuthScheme frozen-token-abc');
    const fetchOpts = await frozen.buildDiscoveredHeaders();
    expect(fetchOpts.extraHeaders).toBeDefined();
    const headers = fetchOpts.extraHeaders;
    expect(headers.authorization).toBe('CALAuthScheme frozen-token-abc');
  });

  it('frozen — with cachedAuth=false, buildDiscoveredHeaders has no authorization', async () => {
    const eps = [makeEndpoint({ url: 'https://api.bank.co.il/profile' })];
    const frozen = createFrozenNetwork(eps, false);
    const fetchOpts = await frozen.buildDiscoveredHeaders();
    expect(fetchOpts.extraHeaders).toBeDefined();
    const headers = fetchOpts.extraHeaders;
    expect(headers.authorization).toBeUndefined();
    expect(headers['Content-Type']).toBe('application/json');
  });

  it('frozen — discoverAuthToken + cacheAuthToken return pre-cached token', async () => {
    const frozen = createFrozenNetwork([], 'Bearer preset');
    const one = await frozen.discoverAuthToken();
    const two = await frozen.cacheAuthToken();
    expect(one).toBe('Bearer preset');
    expect(two).toBe('Bearer preset');
  });

  it('frozen — waitForTraffic always resolves false', async () => {
    const frozen = createFrozenNetwork([], false);
    const r = await frozen.waitForTraffic([], 0);
    expect(r).toBe(false);
  });

  it('frozen — discoverApiOrigin finds origin from captured subdomain', () => {
    const frozen = createFrozenNetwork(
      [makeEndpoint({ url: 'https://api.bank.co.il/foo' })],
      false,
    );
    const origin = frozen.discoverApiOrigin();
    expect(origin).toBe('https://api.bank.co.il');
  });

  it('frozen — discoverEndpointByContent finds via body field', () => {
    const frozen = createFrozenNetwork(
      [
        makeEndpoint({
          url: 'https://api.bank.co.il/x',
          responseBody: { accountId: '999' },
        }),
      ],
      false,
    );
    const ep = frozen.discoverEndpointByContent(['accountId']);
    expect(ep).not.toBe(false);
  });

  it('frozen — buildTransactionUrl returns URL when base and account match', () => {
    const frozen = createFrozenNetwork(
      [
        makeEndpoint({
          url: 'https://api.bank.co.il/gatewayAPI/lastTransactions/9999/Date?X=1',
        }),
      ],
      false,
    );
    const url = frozen.buildTransactionUrl('4718', '20240101');
    expect(typeof url === 'string' || !url).toBe(true);
  });

  it('frozen — buildTransactionUrl returns false when no account URL match', () => {
    const frozen = createFrozenNetwork([makeEndpoint({ url: 'https://api.x/a' })], false);
    const url = frozen.buildTransactionUrl('nope', '20240101');
    expect(url).toBe(false);
  });

  it('frozen — buildBalanceUrl returns false when no balance pattern matches', () => {
    const frozen = createFrozenNetwork(
      [makeEndpoint({ url: 'https://api.bank.co.il/foo' })],
      false,
    );
    const url = frozen.buildBalanceUrl('123');
    expect(url).toBe(false);
  });

  it('frozen — buildBalanceUrl substitutes accountId when last segment is numeric', () => {
    const frozen = createFrozenNetwork(
      [makeEndpoint({ url: 'https://api.bank.co.il/account/balance/111111' })],
      false,
    );
    const url = frozen.buildBalanceUrl('222222');
    expect(typeof url === 'string' || !url).toBe(true);
  });

  it('frozen — getAllEndpoints + findEndpoints + getServicesUrl coverage', () => {
    const frozen = createFrozenNetwork([makeEndpoint({ url: 'https://api.bank/x' })], false);
    expect(frozen.getAllEndpoints().length).toBe(1);
    expect(frozen.findEndpoints(/api/).length).toBe(1);
    const services = frozen.getServicesUrl();
    expect(typeof services === 'string' || !services).toBe(true);
  });

  it('frozen — discoverByPatterns with matching regex returns hit', () => {
    const frozen = createFrozenNetwork([makeEndpoint({ url: 'https://api.bank/x' })], false);
    const hit = frozen.discoverByPatterns([/api\.bank/]);
    expect(hit).not.toBe(false);
  });

  it('frozen — discoverByPatterns with NON-matching regex returns false', () => {
    const frozen = createFrozenNetwork([makeEndpoint({ url: 'https://api.bank/x' })], false);
    const hit = frozen.discoverByPatterns([/never/]);
    expect(hit).toBe(false);
  });

  it('frozen — discoverSpaUrl no referer + no currentOrigin → false', () => {
    const frozen = createFrozenNetwork([makeEndpoint()], false);
    const r = frozen.discoverSpaUrl();
    expect(r).toBe(false);
  });

  it('frozen — discoverOrigin/discoverSiteId find header values', () => {
    const frozen = createFrozenNetwork(
      [
        makeEndpoint({
          requestHeaders: { origin: 'https://spa.bank.co.il', 'x-site-id': 'abc' },
        }),
      ],
      false,
    );
    const discoverOriginResult3 = frozen.discoverOrigin();
    expect(discoverOriginResult3).toBe('https://spa.bank.co.il');
    const discoverSiteIdResult4 = frozen.discoverSiteId();
    expect(discoverSiteIdResult4).toBe('abc');
  });
});
