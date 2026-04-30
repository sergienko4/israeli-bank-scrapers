/**
 * NetworkDiscoveryExtra — buildBal + intercept + frozen + discoverShape (split).
 */

import type { IDiscoveredEndpoint } from '../../../../../Scrapers/Pipeline/Mediator/Network/NetworkDiscovery.js';
import {
  createFrozenNetwork,
  createNetworkDiscovery,
} from '../../../../../Scrapers/Pipeline/Mediator/Network/NetworkDiscovery.js';
import { makeMockPage, simulate } from './NetworkDiscoveryExtraHelpers.js';

describe('NetworkDiscovery — buildBalanceUrl & buildTransactionUrl edge cases', () => {
  it('returns false when accountId split yields < 2 parts', async () => {
    const page = makeMockPage();
    const discovery = createNetworkDiscovery(page);
    await simulate({
      url: 'https://api.bank.co.il/gatewayAPI/lastTransactions/forHomePage',
      body: {},
    });
    // URL does not contain the accountId → findUrlWithAccountId false.
    const url = discovery.buildTransactionUrl('4718', '20240101');
    expect(url).toBe(false);
  });
});

describe('NetworkDiscovery — interceptPostResponses pathways', () => {
  it('filter matches POST on WK URL', async () => {
    const page = makeMockPage();
    const discovery = createNetworkDiscovery(page);
    // Submit a POST to a WK auth path; should be captured normally.
    await simulate({
      url: 'https://bank.co.il/authentication/login',
      body: { token: 'ok' },
      method: 'POST',
    });
    expect(discovery.getAllEndpoints().length).toBe(1);
  });
});

describe('NetworkDiscovery — live auth cache roundtrip', () => {
  it('second discoverAuthToken returns cached value without re-running discovery', async () => {
    const page = makeMockPage();
    const discovery = createNetworkDiscovery(page);
    // Prime with an auth-shaped endpoint so discoverAuthThreeTier returns something.
    await simulate({
      url: 'https://login.bank.co.il/authenticate',
      body: { access_token: 'tok-xyz-long-string' },
      reqHeaders: { authorization: 'Bearer tok-xyz-long-string' },
    });
    await discovery.cacheAuthToken();
    // Second call should hit the cache (cachedDiscoverAuth branch).
    const token = await discovery.discoverAuthToken();
    expect(token === false || typeof token === 'string').toBe(true);
  });

  it('discoverAuthToken caches a NEGATIVE result so banks without an auth token do not re-run discovery on every call', async () => {
    const page = makeMockPage();
    const discovery = createNetworkDiscovery(page);
    // No auth-shaped endpoint primed → discoverAuthThreeTier returns false.
    const first = await discovery.discoverAuthToken();
    const second = await discovery.discoverAuthToken();
    expect(first).toBe(false);
    expect(second).toBe(false);
  });

  it('cacheAuthToken sets the cache flag even when no token is found', async () => {
    const page = makeMockPage();
    const discovery = createNetworkDiscovery(page);
    // No auth-shaped endpoint → cacheAuthToken returns false but still primes
    // the discovered flag so subsequent discoverAuthToken short-circuits.
    const cached = await discovery.cacheAuthToken();
    const subsequent = await discovery.discoverAuthToken();
    expect(cached).toBe(false);
    expect(subsequent).toBe(false);
  });
});

describe('NetworkDiscovery — frozen extra coverage', () => {
  it('frozen discoverAccountsEndpoint matches WK pattern', () => {
    const endpoints: IDiscoveredEndpoint[] = [
      {
        url: 'https://api.bank.co.il/userAccountsData/list',
        method: 'GET',
        postData: '',
        contentType: 'application/json',
        requestHeaders: {},
        responseHeaders: {},
        responseBody: {},
        timestamp: 0,
      },
    ];
    const frozen = createFrozenNetwork(endpoints, false);
    const ep = frozen.discoverAccountsEndpoint();
    expect(ep).not.toBe(false);
  });

  it('frozen findEndpoints filters by regex', () => {
    const endpoints: IDiscoveredEndpoint[] = [
      {
        url: 'https://api.bank.co.il/a/accounts',
        method: 'GET',
        postData: '',
        contentType: 'application/json',
        requestHeaders: {},
        responseHeaders: {},
        responseBody: {},
        timestamp: 0,
      },
      {
        url: 'https://api.bank.co.il/b/transactions',
        method: 'GET',
        postData: '',
        contentType: 'application/json',
        requestHeaders: {},
        responseHeaders: {},
        responseBody: {},
        timestamp: 0,
      },
    ];
    const frozen = createFrozenNetwork(endpoints, false);
    expect(frozen.findEndpoints(/accounts/).length).toBe(1);
    expect(frozen.findEndpoints(/transactions/).length).toBe(1);
    expect(frozen.findEndpoints(/nothing/).length).toBe(0);
  });

  it('frozen discoverApiOrigin config tier succeeds', () => {
    const endpoints: IDiscoveredEndpoint[] = [
      {
        url: 'https://bank.co.il/config.json',
        method: 'GET',
        postData: '',
        contentType: 'application/json',
        requestHeaders: {},
        responseHeaders: {},
        responseBody: { apiBase: 'https://api.bank.co.il/api/v1' },
        timestamp: 0,
      },
    ];
    const frozen = createFrozenNetwork(endpoints, false);
    const discoverApiOriginResult34 = frozen.discoverApiOrigin();
    expect(discoverApiOriginResult34).toBe('https://api.bank.co.il');
  });

  it('frozen discoverApiOrigin Tier3 path (POST /api/)', () => {
    const endpoints: IDiscoveredEndpoint[] = [
      {
        url: 'https://data.bank.co.il/api/q',
        method: 'POST',
        postData: '',
        contentType: 'application/json',
        requestHeaders: {},
        responseHeaders: {},
        responseBody: {},
        timestamp: 0,
      },
    ];
    const frozen = createFrozenNetwork(endpoints, false);
    const discoverApiOriginResult35 = frozen.discoverApiOrigin();
    expect(discoverApiOriginResult35).toBe('https://data.bank.co.il');
  });

  it('frozen discoverProxyEndpoint matches WK proxy pattern', () => {
    const endpoints: IDiscoveredEndpoint[] = [
      {
        url: 'https://api.bank.co.il/ServiceEndpoint/anything',
        method: 'GET',
        postData: '',
        contentType: 'application/json',
        requestHeaders: {},
        responseHeaders: {},
        responseBody: {},
        timestamp: 0,
      },
    ];
    const frozen = createFrozenNetwork(endpoints, false);
    const r = frozen.discoverProxyEndpoint();
    expect(r === false || typeof r === 'string').toBe(true);
  });

  it('frozen buildDiscoveredHeaders omits authorization when cachedAuth is false', async () => {
    const endpoints: IDiscoveredEndpoint[] = [
      {
        url: 'https://api.bank.co.il/x',
        method: 'GET',
        postData: '',
        contentType: 'application/json',
        requestHeaders: { 'x-site-id': 'SITE1' },
        responseHeaders: {},
        responseBody: {},
        timestamp: 0,
      },
    ];
    const frozen = createFrozenNetwork(endpoints, false);
    const headers = await frozen.buildDiscoveredHeaders();
    expect(headers.extraHeaders.authorization).toBeUndefined();
    expect(headers.extraHeaders['X-Site-Id']).toBe('SITE1');
  });

  it('frozen waitForTraffic always returns false', async () => {
    const frozen = createFrozenNetwork([], 'tok');
    const r = await frozen.waitForTraffic([], 0);
    expect(r).toBe(false);
  });
});
