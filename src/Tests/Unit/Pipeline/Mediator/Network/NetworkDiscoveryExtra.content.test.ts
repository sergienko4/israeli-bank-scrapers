/**
 * NetworkDiscoveryExtra — content scan + discoverApiOrigin + SPA filters (split).
 */

import type { IDiscoveredEndpoint } from '../../../../../Scrapers/Pipeline/Mediator/Network/NetworkDiscovery.js';
import {
  createFrozenNetwork,
  createNetworkDiscovery,
} from '../../../../../Scrapers/Pipeline/Mediator/Network/NetworkDiscovery.js';
import { makeMockPage, simulate } from './NetworkDiscoveryExtraHelpers.js';

describe('NetworkDiscovery — content scan branches', () => {
  it('bodyHasFields returns false for endpoint missing responseBody', async () => {
    await Promise.resolve();
    const endpoints: IDiscoveredEndpoint[] = [
      {
        url: 'https://api.bank.co.il/x',
        method: 'GET',
        postData: '',
        contentType: 'application/json',
        requestHeaders: {},
        responseHeaders: {},
        responseBody: 0 as unknown as Record<string, unknown>,
        timestamp: 0,
      },
    ];
    const frozen = createFrozenNetwork(endpoints, false);
    // responseBody is 0 → !ep.responseBody → skip
    const discoverEndpointByContentResult25 = frozen.discoverEndpointByContent(['foo']);
    expect(discoverEndpointByContentResult25).toBe(false);
  });

  it('discoverEndpointByContent finds body containing field name as JSON key', async () => {
    const page = makeMockPage();
    const discovery = createNetworkDiscovery(page);
    await simulate({
      url: 'https://api.bank.co.il/a',
      body: { someField: 'value', otherField: 123 },
    });
    const discoverEndpointByContentResult26 = discovery.discoverEndpointByContent(['someField']);
    expect(discoverEndpointByContentResult26).not.toBe(false);
    const discoverEndpointByContentResult27 = discovery.discoverEndpointByContent(['notPresent']);
    expect(discoverEndpointByContentResult27).toBe(false);
  });
});

describe('NetworkDiscovery — discoverApiOrigin tier fallbacks', () => {
  it('Tier 1 (config body) wins when URL contains settings', async () => {
    const page = makeMockPage();
    const discovery = createNetworkDiscovery(page);
    await simulate({
      url: 'https://bank.co.il/app/settings.json',
      body: { apiBase: 'https://api.bank.co.il/api/v2' },
    });
    const discoverApiOriginResult28 = discovery.discoverApiOrigin();
    expect(discoverApiOriginResult28).toBe('https://api.bank.co.il');
  });

  it('Tier 1 fallback when body has no /api/ URLs', async () => {
    const page = makeMockPage();
    const discovery = createNetworkDiscovery(page);
    await simulate({
      url: 'https://bank.co.il/config.json',
      body: { notApi: 'https://other.com/static/page' },
    });
    // config endpoint exists but body has no /api/ URL → Tier1 returns false → Tier2 falls through.
    const discoverApiOriginResult29 = discovery.discoverApiOrigin();
    expect(discoverApiOriginResult29).toBe(false);
  });
});

describe('NetworkDiscovery — SPA discovery tier filters', () => {
  it('Tier 3 filters out infra subdomains (api., cdn., login., etc.)', async () => {
    const page = makeMockPage('https://www.bank.co.il');
    const discovery = createNetworkDiscovery(page);
    await simulate({
      url: 'https://www.bank.co.il/config.json',
      body: {
        apiUrl: 'https://api.bank.co.il/x',
        cdnUrl: 'https://cdn.bank.co.il/static',
      },
    });
    const result = discovery.discoverSpaUrl('https://www.bank.co.il');
    // Both candidates are infra → filtered out → Tier 3 returns false.
    expect(result).toBe(false);
  });

  it('Tier 3 accepts non-infra same-parent subdomain', async () => {
    const page = makeMockPage('https://www.bank.co.il');
    const discovery = createNetworkDiscovery(page);
    await simulate({
      url: 'https://www.bank.co.il/config.json',
      body: { spaUrl: 'https://dashboard.bank.co.il/home' },
    });
    const result = discovery.discoverSpaUrl('https://www.bank.co.il');
    expect(typeof result).toBe('string');
  });

  it('Tier 2 CORS returns false on wildcard *', async () => {
    const page = makeMockPage('https://api.bank.co.il');
    const discovery = createNetworkDiscovery(page);
    await simulate({
      url: 'https://api.bank.co.il/x',
      body: {},
      resHeaders: { 'access-control-allow-origin': '*' },
    });
    // Wildcard explicitly rejected → checkCorsHeader returns false.
    const r = discovery.discoverSpaUrl('https://api.bank.co.il');
    expect(r).toBe(false);
  });

  it('Tier 2 CORS returns false on missing header', async () => {
    const page = makeMockPage('https://api.bank.co.il');
    const discovery = createNetworkDiscovery(page);
    await simulate({
      url: 'https://api.bank.co.il/x',
      body: {},
    });
    const discoverSpaUrlResult30 = discovery.discoverSpaUrl('https://api.bank.co.il');
    expect(discoverSpaUrlResult30).toBe(false);
  });

  it('Tier 2 CORS skips when corsOrigin equals epOrigin', async () => {
    const page = makeMockPage('https://www.bank.co.il');
    const discovery = createNetworkDiscovery(page);
    await simulate({
      url: 'https://api.bank.co.il/x',
      body: {},
      resHeaders: { 'access-control-allow-origin': 'https://api.bank.co.il' },
    });
    // corsOrigin === epOrigin → not cross → skip.
    const discoverSpaUrlResult31 = discovery.discoverSpaUrl('https://www.bank.co.il');
    expect(discoverSpaUrlResult31).toBe(false);
  });

  it('Tier 2 CORS skips when corsOrigin equals pageOrigin', async () => {
    const page = makeMockPage('https://www.bank.co.il');
    const discovery = createNetworkDiscovery(page);
    await simulate({
      url: 'https://api.bank.co.il/x',
      body: {},
      resHeaders: { 'access-control-allow-origin': 'https://www.bank.co.il' },
    });
    const discoverSpaUrlResult32 = discovery.discoverSpaUrl('https://www.bank.co.il');
    expect(discoverSpaUrlResult32).toBe(false);
  });

  it('Tier 1 skips endpoint without referer header', async () => {
    const page = makeMockPage('https://www.bank.co.il');
    const discovery = createNetworkDiscovery(page);
    await simulate({
      url: 'https://api.bank.co.il/authentication/login',
      body: {},
    });
    const discoverSpaUrlResult33 = discovery.discoverSpaUrl('https://www.bank.co.il');
    expect(discoverSpaUrlResult33).toBe(false);
  });
});
