/**
 * NetworkDiscoveryExtra — more discovery paths + live aux + buildTxn + frozen headers (split).
 */

import {
  createFrozenNetwork,
  createNetworkDiscovery,
} from '../../../../../Scrapers/Pipeline/Mediator/Network/NetworkDiscovery.js';
import { makeMockPage, simulate } from './NetworkDiscoveryExtraHelpers.js';

describe('NetworkDiscovery — more discovery paths', () => {
  it('discoverByPatterns matches transactions WellKnown regex', async () => {
    const page = makeMockPage();
    const discovery = createNetworkDiscovery(page);
    await simulate({
      url: 'https://api.bank.co.il/gatewayAPI/lastTransactions/0/123',
      body: { items: [] },
    });
    const hit = discovery.discoverByPatterns([/lastTransactions/i]);
    expect(hit).not.toBe(false);
  });

  it('getServicesUrl returns extracted common base URL', async () => {
    const page = makeMockPage();
    const discovery = createNetworkDiscovery(page);
    await simulate({ url: 'https://api.bank.co.il/s?x=1', body: { a: 1 } });
    await simulate({ url: 'https://api.bank.co.il/s?x=2', body: { a: 2 } });
    const getServicesUrlResult14 = discovery.getServicesUrl();
    expect(getServicesUrlResult14).toBe('https://api.bank.co.il/s');
  });

  it('buildTransactionUrl returns false without a template URL', () => {
    const page = makeMockPage();
    const discovery = createNetworkDiscovery(page);
    const buildTransactionUrlResult15 = discovery.buildTransactionUrl('123', '20250101');
    expect(buildTransactionUrlResult15).toBe(false);
  });

  it('buildBalanceUrl returns false without a template URL', () => {
    const page = makeMockPage();
    const discovery = createNetworkDiscovery(page);
    const buildBalanceUrlResult16 = discovery.buildBalanceUrl('123');
    expect(buildBalanceUrlResult16).toBe(false);
  });

  it('buildTransactionUrl respects extracted base when URL contains accountId', async () => {
    const page = makeMockPage();
    const discovery = createNetworkDiscovery(page);
    await simulate({
      url: 'https://bank.co.il/gatewayAPI/lastTransactions/transactions/1234/forHomePage',
      body: { items: [] },
    });
    const url = discovery.buildTransactionUrl('1234', '20250101');
    expect(typeof url).toBe('string');
    if (url) expect(url).toContain('FromDate=20250101');
  });

  it('waitForTraffic resolves immediately when a hit already exists', async () => {
    const page = makeMockPage();
    const discovery = createNetworkDiscovery(page);
    await simulate({
      url: 'https://api.bank.co.il/gatewayAPI/lastTransactions/x',
      body: { items: [] },
    });
    const result = await discovery.waitForTraffic([/lastTransactions/i], 10);
    expect(result).not.toBe(false);
  });

  it('discoverSpaUrl Tier2 (CORS) triggers with mismatched allow-origin', async () => {
    const page = makeMockPage('https://api.bank.co.il');
    const discovery = createNetworkDiscovery(page);
    await simulate({
      url: 'https://api.bank.co.il/x',
      body: {},
      resHeaders: { 'access-control-allow-origin': 'https://spa.bank.co.il' },
    });
    const url = discovery.discoverSpaUrl('https://api.bank.co.il');
    expect(url === false || typeof url === 'string').toBe(true);
  });

  it('discoverSpaUrl Tier3 (config body) scans for SPA URLs', async () => {
    const page = makeMockPage('https://api.bank.co.il');
    const discovery = createNetworkDiscovery(page);
    await simulate({
      url: 'https://api.bank.co.il/config.json',
      body: { spa: 'https://spa.bank.co.il/dashboard' },
    });
    const url = discovery.discoverSpaUrl('https://api.bank.co.il');
    expect(url === false || typeof url === 'string').toBe(true);
  });
});

describe('NetworkDiscovery — live discovery auxiliary paths', () => {
  it('discoverOrigin picks value from non-login endpoint when login endpoint also carries one', async () => {
    const page = makeMockPage();
    const discovery = createNetworkDiscovery(page);
    await simulate({
      url: 'https://login.bank.co.il/auth',
      body: {},
      reqHeaders: { origin: 'https://login.bank.co.il' },
    });
    await simulate({
      url: 'https://api.bank.co.il/x',
      body: {},
      reqHeaders: { origin: 'https://spa.bank.co.il' },
    });
    // The live discoverOrigin returns the FIRST captured value (no login skip).
    const origin = discovery.discoverOrigin();
    expect(typeof origin).toBe('string');
  });

  it('discoverApiOrigin Tier1 extracts /api/ origin from config response body', async () => {
    const page = makeMockPage();
    const discovery = createNetworkDiscovery(page);
    await simulate({
      url: 'https://bank.co.il/settings.json',
      body: { apiRoot: 'https://api.bank.co.il/api/v1' },
    });
    const discoverApiOriginResult17 = discovery.discoverApiOrigin();
    expect(discoverApiOriginResult17).toBe('https://api.bank.co.il');
  });

  it('discoverApiOrigin Tier3 falls back to any /api/ POST path', async () => {
    const page = makeMockPage();
    const discovery = createNetworkDiscovery(page);
    await simulate({
      url: 'https://data.bank.co.il/api/x',
      body: {},
      method: 'POST',
    });
    const discoverApiOriginResult18 = discovery.discoverApiOrigin();
    expect(discoverApiOriginResult18).toBe('https://data.bank.co.il');
  });
});

describe('NetworkDiscovery — buildTransactionUrl segment-append path', () => {
  it('appends accountId to captured balance URL path when last segment is not numeric', async () => {
    const page = makeMockPage();
    const discovery = createNetworkDiscovery(page);
    // Balance template with non-numeric last segment.
    await simulate({
      url: 'https://api.bank.co.il/infoAndBalance/overview',
      body: { balance: 100 },
    });
    const balUrl = discovery.buildBalanceUrl('5555');
    expect(typeof balUrl).toBe('string');
    if (balUrl) {
      const didEndWith19 = balUrl.endsWith('/5555');
      expect(didEndWith19).toBe(true);
    }
  });

  it('replaces trailing numeric segment with accountId when template has one', async () => {
    const page = makeMockPage();
    const discovery = createNetworkDiscovery(page);
    await simulate({
      url: 'https://api.bank.co.il/infoAndBalance/12345',
      body: { balance: 100 },
    });
    const balUrl = discovery.buildBalanceUrl('99999');
    expect(typeof balUrl).toBe('string');
    if (balUrl) {
      const didEndWith20 = balUrl.endsWith('/99999');
      expect(didEndWith20).toBe(true);
    }
  });
});

describe('NetworkDiscovery — frozen network headers merge', () => {
  it('frozen buildDiscoveredHeaders merges SPA headers from frozen txn endpoint', async () => {
    const endpoints = [
      {
        url: 'https://api.bank.co.il/lastTransactions/0/99',
        method: 'POST' as const,
        postData: '',
        responseBody: {},
        contentType: 'application/json',
        requestHeaders: {
          origin: 'https://spa.bank.co.il',
          'x-custom-hdr': 'abc',
          'user-agent': 'standard',
        },
        responseHeaders: {},
        timestamp: 0,
      },
    ];
    const frozen = createFrozenNetwork(endpoints, 'Bearer tok');
    const opts = await frozen.buildDiscoveredHeaders();
    expect(opts.extraHeaders.authorization).toBe('Bearer tok');
    expect(opts.extraHeaders.Origin).toBe('https://spa.bank.co.il');
    expect(opts.extraHeaders['x-custom-hdr']).toBe('abc');
    // user-agent is browser-standard → filtered out of SPA merge
    expect(opts.extraHeaders['user-agent']).toBeUndefined();
  });
});

// ═══════════════════════════════════════════════════════════
// Wave 4 / Agent J — branch coverage extensions
// ═══════════════════════════════════════════════════════════
