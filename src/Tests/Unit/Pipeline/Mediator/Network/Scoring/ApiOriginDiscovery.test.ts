/**
 * Phase 2 coverage closeout — ApiOriginDiscovery.ts shipped without
 * a dedicated test, leaving the 3-tier discovery in
 * `discoverApiOriginFromTraffic` and the CR PR #276 #9 guarded URL
 * parse branches uncovered (BRDA 50, 76, 106). Banks regularly serve
 * malformed referer / CORS / config-body URLs that crashed the
 * pre-CR-#9 unguarded `new URL()` — the guarded branches are the
 * regression net for that crash, so pin them with positive
 * (success) + negative (malformed) input pairs through the public
 * default export.
 *
 * <p>BRDA 90 (`discoverApiFromSubdomain` re-parse guard) is
 * deliberately defensive — the predicate at line 87 already proved
 * the URL parses; the re-parse at line 89 cannot fail on the same
 * input — so it remains intentionally unreachable and is NOT
 * targeted here.
 */
import type { IDiscoveredEndpoint } from '../../../../../../Scrapers/Pipeline/Mediator/Network/NetworkDiscoveryTypes.js';
import discoverApiOriginFromTraffic from '../../../../../../Scrapers/Pipeline/Mediator/Network/Scoring/ApiOriginDiscovery.js';

/**
 * Module-scope endpoint fixture base. Hoisting out of the helper
 * function keeps `buildEndpoint` under the §19.11 ≤10-line cap
 * (CR PR #336 #1 — the inline-object variant ran 13 lines and
 * tripped `phase9-local/fn-declaration-max-lines`).
 */
const ENDPOINT_BASE: IDiscoveredEndpoint = {
  url: 'https://bank.example/static/style.css',
  method: 'GET',
  postData: '',
  contentType: 'application/json',
  requestHeaders: {},
  responseHeaders: {},
  responseBody: {},
  timestamp: 1,
  status: 200,
};

/**
 * Build a captured endpoint with controllable URL + body + method.
 * @param overrides - Per-test endpoint overrides.
 * @returns Captured endpoint matching the `IDiscoveredEndpoint` shape.
 */
function buildEndpoint(overrides: Partial<IDiscoveredEndpoint> = {}): IDiscoveredEndpoint {
  return { ...ENDPOINT_BASE, ...overrides };
}

describe('ApiOriginDiscovery — Tier 1 (config body)', () => {
  it('AOD-T1-001 extracts the API origin from a config body that lists API URLs', () => {
    const capture = buildEndpoint({
      url: 'https://bank.example/client-config.json',
      responseBody: { endpoints: { txn: 'https://api.bank.example/api/v1/' } },
    });
    const origin = discoverApiOriginFromTraffic([capture]);
    expect(origin).toBe('https://api.bank.example');
  });

  it('AOD-T1-002 returns false when the config body has no API URL match', () => {
    const capture = buildEndpoint({
      url: 'https://bank.example/client-config.json',
      responseBody: { theme: 'dark' },
    });
    const origin = discoverApiOriginFromTraffic([capture]);
    expect(origin).toBe(false);
  });

  it('AOD-T1-003 ignores a regex-matched URL whose hostname is malformed (CR PR #276 #9 guard fires)', () => {
    // `https://[/api/` matches the API_PATH_REGEX but `new URL()`
    // throws on the bare `[` (invalid IPv6 literal). Without the
    // CR #9 guard the original `new URL` would crash discovery.
    const capture = buildEndpoint({
      url: 'https://bank.example/client-config.json',
      responseBody: { malformed: 'https://[/api/foo' },
    });
    const origin = discoverApiOriginFromTraffic([capture]);
    expect(origin).toBe(false);
  });
});

describe('ApiOriginDiscovery — Tier 2 (api.* subdomain)', () => {
  it('AOD-T2-001 returns the origin of the first endpoint whose host starts with api.', () => {
    const capture = buildEndpoint({ url: 'https://api.bank.example/v1/accounts' });
    const origin = discoverApiOriginFromTraffic([capture]);
    expect(origin).toBe('https://api.bank.example');
  });

  it('AOD-T2-002 skips malformed-URL endpoints (CR PR #276 #9 guard fires)', () => {
    // hasApiSubdomain calls safeParseWindowUrl; on parse failure
    // it returns false and the endpoint is not chosen.
    const malformed = buildEndpoint({ url: 'not-a-url' });
    const ok = buildEndpoint({ url: 'https://api.bank.example/v1' });
    const origin = discoverApiOriginFromTraffic([malformed, ok]);
    expect(origin).toBe('https://api.bank.example');
  });
});

describe('ApiOriginDiscovery — Tier 3 (POST with /api/ path)', () => {
  it('AOD-T3-001 returns the origin of any POST endpoint containing /api/', () => {
    const capture = buildEndpoint({
      url: 'https://gateway.bank.example/api/login',
      method: 'POST',
    });
    const origin = discoverApiOriginFromTraffic([capture]);
    expect(origin).toBe('https://gateway.bank.example');
  });

  it('AOD-T3-002 returns false when the matching POST URL fails to parse (CR PR #276 #9 guard fires)', () => {
    // `find()` matches on `.includes('/api/')` BEFORE the URL parse;
    // the parse then rejects the malformed scheme-less form,
    // exercising the CR #9 fallthrough.
    const capture = buildEndpoint({
      url: 'malformed-scheme/api/foo',
      method: 'POST',
    });
    const origin = discoverApiOriginFromTraffic([capture]);
    expect(origin).toBe(false);
  });
});

describe('ApiOriginDiscovery — empty pool', () => {
  it('AOD-EMPTY-001 returns false when no captures are present', () => {
    const origin = discoverApiOriginFromTraffic([]);
    expect(origin).toBe(false);
  });
});
