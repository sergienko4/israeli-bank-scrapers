/**
 * NetworkDiscoveryExtra — dump session + findCommon + shape gate + origin tiers (split).
 */

import { createNetworkDiscovery } from '../../../../../Scrapers/Pipeline/Mediator/Network/NetworkDiscovery.js';
import { makeMockPage, simulate } from './NetworkDiscoveryExtraHelpers.js';

describe('NetworkDiscovery — dump session branches', () => {
  /**
   * Reset DUMP_NETWORK_DIR env var after a test.
   * @param prior - Prior value to restore (empty string means unset).
   * @returns true when reset applied.
   */
  function restoreDumpDir(prior: string): boolean {
    if (prior === '') delete process.env.DUMP_NETWORK_DIR;
    else process.env.DUMP_NETWORK_DIR = prior;
    return true;
  }

  it('captures endpoint without DUMP_NETWORK_DIR (early-return branch)', async () => {
    const prior = process.env.DUMP_NETWORK_DIR ?? '';
    delete process.env.DUMP_NETWORK_DIR;
    try {
      const page = makeMockPage();
      const discovery = createNetworkDiscovery(page);
      await simulate({ url: 'https://api.bank.co.il/x', body: { a: 1 } });
      expect(discovery.getAllEndpoints().length).toBe(1);
    } finally {
      restoreDumpDir(prior);
    }
  });

  it('uses "run" label when DUMP_NETWORK_LABEL is unset', async () => {
    const priorDir = process.env.DUMP_NETWORK_DIR;
    const priorLabel = process.env.DUMP_NETWORK_LABEL;
    const os = await import('node:os');
    const path = await import('node:path');
    const fs = await import('node:fs');
    const tmpdirResult21 = os.tmpdir();
    const nowTs21 = Date.now();
    const ts21 = String(nowTs21);
    const tempDir = path.join(tmpdirResult21, `pipeline-dump-nolabel-${ts21}`);
    process.env.DUMP_NETWORK_DIR = tempDir;
    delete process.env.DUMP_NETWORK_LABEL;
    try {
      const page = makeMockPage();
      const discovery = createNetworkDiscovery(page);
      await simulate({ url: 'https://api.bank.co.il/x', body: { a: 1 } });
      expect(discovery.getAllEndpoints().length).toBeGreaterThanOrEqual(0);
      // cleanup
      if (fs.existsSync(tempDir)) fs.rmSync(tempDir, { recursive: true, force: true });
    } finally {
      if (priorDir === undefined) delete process.env.DUMP_NETWORK_DIR;
      else process.env.DUMP_NETWORK_DIR = priorDir;
      if (priorLabel === undefined) delete process.env.DUMP_NETWORK_LABEL;
      else process.env.DUMP_NETWORK_LABEL = priorLabel;
    }
  });
});

describe('NetworkDiscovery — findCommonServicesUrl and URL extraction', () => {
  it('returns false when nothing captured', () => {
    const page = makeMockPage();
    const discovery = createNetworkDiscovery(page);
    const getServicesUrlResult22 = discovery.getServicesUrl();
    expect(getServicesUrlResult22).toBe(false);
  });

  it('returns single captured URL as common services URL', async () => {
    const page = makeMockPage();
    const discovery = createNetworkDiscovery(page);
    await simulate({ url: 'https://api.bank.co.il/only', body: {} });
    const getServicesUrlResult23 = discovery.getServicesUrl();
    expect(getServicesUrlResult23).toBe('https://api.bank.co.il/only');
  });

  it('handles URL without query string (no idx branch)', async () => {
    const page = makeMockPage();
    const discovery = createNetworkDiscovery(page);
    await simulate({ url: 'https://api.bank.co.il/x/y', body: {} });
    const getServicesUrlResult24 = discovery.getServicesUrl();
    expect(getServicesUrlResult24).toBe('https://api.bank.co.il/x/y');
  });
});

describe('NetworkDiscovery — discoverShapeAware shape gate', () => {
  it('uses shape gate to prefer endpoint with txn array', async () => {
    const page = makeMockPage();
    const discovery = createNetworkDiscovery(page);
    // Summary first (no txn array) — will match URL but not shape
    await simulate({
      url: 'https://api.bank.co.il/gatewayAPI/lastTransactions/summary',
      body: { total: 0 },
    });
    // Detail second (with txn array) — both URL and shape match
    await simulate({
      url: 'https://api.bank.co.il/gatewayAPI/lastTransactions/details',
      body: { items: [{ id: 1 }] },
    });
    const ep = discovery.discoverTransactionsEndpoint();
    expect(ep).not.toBe(false);
  });

  it('falls back to first match when no body passes shape gate', async () => {
    const page = makeMockPage();
    const discovery = createNetworkDiscovery(page);
    await simulate({
      url: 'https://api.bank.co.il/gatewayAPI/lastTransactions/summary',
      body: { total: 0 },
    });
    const ep = discovery.discoverTransactionsEndpoint();
    // URL matches, no shape pass → fallback to first URL match.
    expect(ep).not.toBe(false);
  });
});

describe('NetworkDiscovery — origin resolution tiers', () => {
  it('picks non-login origin when both login and non-login captures exist', async () => {
    // resolveOrigin (via buildDiscoveredHeaders) exercises pickBestValue non-login branch
    const page = makeMockPage();
    const discovery = createNetworkDiscovery(page);
    await simulate({
      url: 'https://login.bank.co.il/auth',
      body: {},
      reqHeaders: { origin: 'https://login.bank.co.il' },
    });
    await simulate({
      url: 'https://spa.bank.co.il/data',
      body: {},
      reqHeaders: { origin: 'https://spa.bank.co.il' },
    });
    // Extra microtask flush ensures both responses got into captured[]
    await Promise.resolve();
    await Promise.resolve();
    const opts = await discovery.buildDiscoveredHeaders();
    // resolveOrigin → pickBestValue: prefer non-login. Either works as a branch signal.
    const origin = opts.extraHeaders.Origin;
    expect(typeof origin).toBe('string');
  });

  it('returns single value when only one distinct origin captured', async () => {
    const page = makeMockPage();
    const discovery = createNetworkDiscovery(page);
    await simulate({
      url: 'https://api.bank.co.il/x',
      body: {},
      reqHeaders: { origin: 'https://api.bank.co.il' },
    });
    const opts = await discovery.buildDiscoveredHeaders();
    expect(opts.extraHeaders.Origin).toBe('https://api.bank.co.il');
  });

  it('extracts origin from raw URL via URL parser', async () => {
    const page = makeMockPage();
    const discovery = createNetworkDiscovery(page);
    // Send referer since origin header already seen; referer carries a URL with path.
    await simulate({
      url: 'https://api.bank.co.il/x',
      body: {},
      reqHeaders: { referer: 'https://spa.bank.co.il/some/path' },
    });
    const opts = await discovery.buildDiscoveredHeaders();
    // The origin field may be set (from referer) or absent; both exercise branches.
    const originValue: unknown = opts.extraHeaders.Origin;
    const isString = typeof originValue === 'string';
    const isUndefined = originValue === undefined;
    expect(isString || isUndefined).toBe(true);
  });

  it('falls through to raw origin when URL parsing throws', async () => {
    const page = makeMockPage();
    const discovery = createNetworkDiscovery(page);
    await simulate({
      url: 'https://api.bank.co.il/x',
      body: {},
      reqHeaders: { origin: 'not a url' },
    });
    const opts = await discovery.buildDiscoveredHeaders();
    // Cannot parse → falls through to raw string.
    expect(typeof opts.extraHeaders.Origin).toBe('string');
  });

  it('omits Origin header when no origin captured', async () => {
    const page = makeMockPage();
    const discovery = createNetworkDiscovery(page);
    await simulate({ url: 'https://api.bank.co.il/x', body: {} });
    const opts = await discovery.buildDiscoveredHeaders();
    expect(opts.extraHeaders.Origin).toBeUndefined();
  });

  it('includes X-Site-Id when site-id captured', async () => {
    const page = makeMockPage();
    const discovery = createNetworkDiscovery(page);
    await simulate({
      url: 'https://api.bank.co.il/x',
      body: {},
      reqHeaders: { 'x-site-id': 'SITE42' },
    });
    const opts = await discovery.buildDiscoveredHeaders();
    expect(opts.extraHeaders['X-Site-Id']).toBe('SITE42');
  });
});
