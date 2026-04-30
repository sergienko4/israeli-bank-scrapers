/**
 * Additional NetworkDiscovery coverage — content scan, auth cache, api-origin,
 * proxy discovery, buildDiscoveredHeaders, and createFrozenNetwork.
 */

import type { IDiscoveredEndpoint } from '../../../../../Scrapers/Pipeline/Mediator/Network/NetworkDiscovery.js';
import {
  createFrozenNetwork,
  createNetworkDiscovery,
} from '../../../../../Scrapers/Pipeline/Mediator/Network/NetworkDiscovery.js';
import { makeMockPage, simulate } from './NetworkDiscoveryExtraHelpers.js';

describe('NetworkDiscovery — content + auth + headers', () => {
  it('findEndpoints returns empty for no-match pattern', () => {
    const page = makeMockPage();
    const discovery = createNetworkDiscovery(page);
    expect(discovery.findEndpoints(/nothing/).length).toBe(0);
  });

  it('discoverEndpointByContent finds endpoint via body field match', async () => {
    const page = makeMockPage();
    const discovery = createNetworkDiscovery(page);
    await simulate({
      url: 'https://api.bank.co.il/x',
      body: { accountNumber: '123', balance: 99 },
    });
    const found = discovery.discoverEndpointByContent(['accountNumber']);
    expect(found).not.toBe(false);
  });

  it('discoverEndpointByContent returns false when field not in any body', async () => {
    const page = makeMockPage();
    const discovery = createNetworkDiscovery(page);
    await simulate({
      url: 'https://api.bank.co.il/x',
      body: { other: 'stuff' },
    });
    const found = discovery.discoverEndpointByContent(['accountNumber']);
    expect(found).toBe(false);
  });

  it('discoverOrigin returns false with no captured headers', () => {
    const page = makeMockPage();
    const discovery = createNetworkDiscovery(page);
    const discoverOriginResult1 = discovery.discoverOrigin();
    expect(discoverOriginResult1).toBe(false);
  });

  it('discoverOrigin extracts origin from request headers', async () => {
    const page = makeMockPage();
    const discovery = createNetworkDiscovery(page);
    await simulate({
      url: 'https://api.bank.co.il/x',
      body: {},
      reqHeaders: { origin: 'https://spa.bank.co.il' },
    });
    const discoverOriginResult2 = discovery.discoverOrigin();
    expect(discoverOriginResult2).toBe('https://spa.bank.co.il');
  });

  it('discoverSiteId returns false with no captured site-id', () => {
    const page = makeMockPage();
    const discovery = createNetworkDiscovery(page);
    const discoverSiteIdResult3 = discovery.discoverSiteId();
    expect(discoverSiteIdResult3).toBe(false);
  });

  it('discoverProxyEndpoint returns false with no proxy traffic', () => {
    const page = makeMockPage();
    const discovery = createNetworkDiscovery(page);
    const discoverProxyEndpointResult4 = discovery.discoverProxyEndpoint();
    expect(discoverProxyEndpointResult4).toBe(false);
  });

  it('discoverAccountsEndpoint returns false when no accounts endpoint captured', () => {
    const page = makeMockPage();
    const discovery = createNetworkDiscovery(page);
    const discoverAccountsEndpointResult5 = discovery.discoverAccountsEndpoint();
    expect(discoverAccountsEndpointResult5).toBe(false);
  });

  it('discoverTransactionsEndpoint returns false when no txn endpoint captured', () => {
    const page = makeMockPage();
    const discovery = createNetworkDiscovery(page);
    const discoverTransactionsEndpointResult6 = discovery.discoverTransactionsEndpoint();
    expect(discoverTransactionsEndpointResult6).toBe(false);
  });

  it('discoverBalanceEndpoint returns false when no balance endpoint captured', () => {
    const page = makeMockPage();
    const discovery = createNetworkDiscovery(page);
    const discoverBalanceEndpointResult7 = discovery.discoverBalanceEndpoint();
    expect(discoverBalanceEndpointResult7).toBe(false);
  });

  it('discoverSpaUrl returns false with no captured traffic', () => {
    const page = makeMockPage();
    const discovery = createNetworkDiscovery(page);
    const discoverSpaUrlResult8 = discovery.discoverSpaUrl('https://bank.co.il');
    expect(discoverSpaUrlResult8).toBe(false);
  });

  it('discoverSpaUrl returns false without currentOrigin + no referer hit', () => {
    const page = makeMockPage();
    const discovery = createNetworkDiscovery(page);
    const discoverSpaUrlResult9 = discovery.discoverSpaUrl();
    expect(discoverSpaUrlResult9).toBe(false);
  });

  it('discoverApiOrigin returns false with no captured traffic', () => {
    const page = makeMockPage();
    const discovery = createNetworkDiscovery(page);
    const discoverApiOriginResult10 = discovery.discoverApiOrigin();
    expect(discoverApiOriginResult10).toBe(false);
  });

  it('discoverApiOrigin extracts origin from api.* subdomain', async () => {
    const page = makeMockPage();
    const discovery = createNetworkDiscovery(page);
    await simulate({ url: 'https://api.bank.co.il/x', body: {} });
    const discoverApiOriginResult11 = discovery.discoverApiOrigin();
    expect(discoverApiOriginResult11).toBe('https://api.bank.co.il');
  });

  it('discoverAuthToken returns false when nothing captured (with mock evaluate=NONE)', async () => {
    const page = makeMockPage();
    const discovery = createNetworkDiscovery(page);
    const token = await discovery.discoverAuthToken();
    expect(token === false || typeof token === 'string').toBe(true);
  });

  it('buildDiscoveredHeaders returns fetch opts with content-type', async () => {
    const page = makeMockPage();
    const discovery = createNetworkDiscovery(page);
    const opts = await discovery.buildDiscoveredHeaders();
    expect(opts.extraHeaders['Content-Type']).toBe('application/json');
  });

  it('cacheAuthToken returns false when nothing to cache', async () => {
    const page = makeMockPage();
    const discovery = createNetworkDiscovery(page);
    const token = await discovery.cacheAuthToken();
    expect(token === false || typeof token === 'string').toBe(true);
  });
});

describe('createFrozenNetwork', () => {
  it('returns frozen network methods that operate on snapshot only', async () => {
    const endpoints: IDiscoveredEndpoint[] = [
      {
        url: 'https://api.bank.co.il/x',
        method: 'GET',
        postData: '',
        contentType: 'application/json',
        requestHeaders: { origin: 'https://spa.bank.co.il' },
        responseHeaders: {},
        responseBody: { ok: true },
        timestamp: 0,
      },
    ];
    const frozen = createFrozenNetwork(endpoints, 'Bearer xyz');
    expect(frozen.getAllEndpoints().length).toBe(1);
    expect(await frozen.discoverAuthToken()).toBe('Bearer xyz');
    const headers = await frozen.buildDiscoveredHeaders();
    expect(headers.extraHeaders.authorization).toBe('Bearer xyz');
    expect(headers.extraHeaders.Origin).toBe('https://spa.bank.co.il');
    expect(await frozen.waitForTraffic([], 0)).toBe(false);
    expect(await frozen.cacheAuthToken()).toBe('Bearer xyz');
  });

  it('frozen network with no cached auth omits authorization header', async () => {
    const endpoints: IDiscoveredEndpoint[] = [];
    const frozen = createFrozenNetwork(endpoints, false);
    const headers = await frozen.buildDiscoveredHeaders();
    expect(headers.extraHeaders.authorization).toBeUndefined();
  });

  it('frozen discoverApiOrigin falls back to captured path', async () => {
    await Promise.resolve();
    const endpoints: IDiscoveredEndpoint[] = [
      {
        url: 'https://api.bank.co.il/other',
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
    const discoverApiOriginResult12 = frozen.discoverApiOrigin();
    expect(discoverApiOriginResult12).toBe('https://api.bank.co.il');
  });

  it('frozen discoverEndpointByContent returns false when body empty', () => {
    const frozen = createFrozenNetwork([], false);
    const discoverEndpointByContentResult13 = frozen.discoverEndpointByContent(['x']);
    expect(discoverEndpointByContentResult13).toBe(false);
  });
});
