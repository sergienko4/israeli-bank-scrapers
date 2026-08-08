/**
 * BIND-API-MEDIATOR discovered-header DONOR SCOPE — regression coverage for the
 * wrong-family header defect.
 *
 * <p>Context: the header bag adopts the FIRST captured request carrying a
 * wanted header. A bank whose login journey spans several origins can
 * therefore donate a header minted for a DIFFERENT service; the gateway
 * rejects the call with an opaque 5xx that reads like an expired session, so
 * the run fails as "zero accounts" and the real cause stays
 * invisible. These tests assert the resolved header VALUE — not merely its
 * presence, which is what the pre-existing coverage checked and why the
 * defect shipped green.
 *
 * <p>Fixtures mirror the real capture pool: a marketing-site request carrying
 * the public widget identifier, and the SPA's own data-API request carrying
 * the gateway identifier. Only the latter may donate.
 */

import type { IDiscoveredEndpoint } from '../../../../../Scrapers/Pipeline/Mediator/Network/Types/Endpoint.js';
import { buildDiscoveredHeaderBag } from '../../../../../Scrapers/Pipeline/Phases/BindApiMediator/BindApiMediatorAuth.js';

/** Local mirror of the registry bank-config shape (import is DI-restricted). */
interface ITestBankConfig {
  readonly urls: { readonly base: string };
  readonly balanceKind: 'account' | 'card-cycle';
  readonly authStrategyKind: 'token' | 'session-cookie' | 'api-direct';
  readonly installDiscoveredHeaders?: boolean;
  readonly discoveredHeadersUrlMatch?: string;
  readonly pinnedDiscoveredHeaders?: Readonly<Record<string, string>>;
}

/** Gateway identifier the data API accepts (the SPA's compiled-in constant). */
const API_SITE_ID = '09031987-273E-2311-906C-8AF85B17C8D9';

/** Public widget identifier served by the marketing site — a wrong-family donor. */
const MARKETING_SITE_ID = '5B5160DD-F84A-4D72-B67E-65891BA194FF';

/** Data-API host family — the ONLY origin allowed to donate headers. */
const API_HOST = 'api.cal-online.co.il';

/** SPA origin the data-API requests carry as Origin / Referer. */
const SPA_ORIGIN = 'https://digital-web.cal-online.co.il';

/** Sentinel for "header absent" — keeps the helper free of nullable returns. */
const ABSENT = '';

/**
 * Build a captured endpoint carrying the given request headers. Non-header
 * fields are populated because the capture contract declares them required —
 * body-shape guards downstream read `postData` unconditionally.
 * @param url - Captured request URL (matched against the donor scope).
 * @param requestHeaders - Lowercase request headers the capture exposes.
 * @returns Discovered-endpoint literal.
 */
function makeEndpoint(url: string, requestHeaders: Record<string, string>): IDiscoveredEndpoint {
  const rest = { method: 'POST', contentType: 'application/json', responseHeaders: {} };
  return { url, postData: '', responseBody: null, requestHeaders, ...rest } as IDiscoveredEndpoint;
}

/** Marketing-site capture — carries the public widget identifier. */
const MARKETING_CAPTURE = makeEndpoint('https://www.cal-online.co.il/lobby', {
  'x-site-id': MARKETING_SITE_ID,
  origin: 'https://www.cal-online.co.il',
  referer: 'https://www.cal-online.co.il/',
});

/** SPA data-API capture — carries the gateway identifier and the SPA origin. */
const API_CAPTURE = makeEndpoint(`https://${API_HOST}/Authentication/api/account/init`, {
  'x-site-id': API_SITE_ID,
  origin: SPA_ORIGIN,
  referer: `${SPA_ORIGIN}/`,
});

/** Every header the data API requires, as VisaCal pins them. */
const PINNED = { 'X-Site-Id': API_SITE_ID, Origin: SPA_ORIGIN, Referer: SPA_ORIGIN };

/**
 * Build an opted-in `'token'` bank config with the donor-scope knobs applied.
 * @param scope - Data-API substring the donor pool is restricted to.
 * @param pinned - Fallback values for headers the scoped pool cannot supply.
 * @returns Registry-shaped config literal.
 */
function makeConfig(scope?: string, pinned?: Readonly<Record<string, string>>): ITestBankConfig {
  return {
    urls: { base: 'https://www.cal-online.co.il/' },
    balanceKind: 'card-cycle',
    authStrategyKind: 'token',
    installDiscoveredHeaders: true,
    discoveredHeadersUrlMatch: scope,
    pinnedDiscoveredHeaders: pinned,
  };
}

/**
 * Read a header case-insensitively — the bag preserves whatever case the
 * donating request used, so assertions must not depend on it.
 * @param bag - Assembled header bag.
 * @param name - Header name to read (any case).
 * @returns The header value, or {@link ABSENT} when not present.
 */
function readHeader(bag: Readonly<Record<string, string>>, name: string): string {
  const lower = name.toLowerCase();
  const keys = Object.keys(bag);
  const hit = keys.find((k): boolean => k.toLowerCase() === lower);
  return hit === undefined ? ABSENT : bag[hit];
}

/**
 * Assemble the header bag for a pool under the given donor policy.
 * @param pool - Capture pool offered to discovery.
 * @param scope - Data-API substring the donor pool is restricted to.
 * @param pinned - Fallback values for unresolved headers.
 * @returns The assembled header bag.
 */
function buildBag(
  pool: readonly IDiscoveredEndpoint[],
  scope?: string,
  pinned?: Readonly<Record<string, string>>,
): Readonly<Record<string, string>> {
  const config = makeConfig(scope, pinned);
  return buildDiscoveredHeaderBag(config, pool, false);
}

describe('BIND-API-MEDIATOR discovered-header bag — donor scoping', () => {
  it('DHS-1 picks the data-API identifier from a mixed-origin pool', () => {
    const pool = [MARKETING_CAPTURE, API_CAPTURE];
    const bag = buildBag(pool, API_HOST);
    const siteId = readHeader(bag, 'X-Site-Id');
    expect(siteId).toBe(API_SITE_ID);
  });

  it('DHS-2 never adopts a marketing-origin identifier when the SPA is absent', () => {
    const bag = buildBag([MARKETING_CAPTURE], API_HOST);
    const siteId = readHeader(bag, 'X-Site-Id');
    expect(siteId).not.toBe(MARKETING_SITE_ID);
  });

  it('DHS-3 supplies the pin when the scoped pool yields no donor', () => {
    const bag = buildBag([MARKETING_CAPTURE], API_HOST, PINNED);
    const siteId = readHeader(bag, 'X-Site-Id');
    expect(siteId).toBe(API_SITE_ID);
  });

  it('DHS-4 supplies every configured pin, not just the first', () => {
    const bag = buildBag([MARKETING_CAPTURE], API_HOST, PINNED);
    const pair = [readHeader(bag, 'Origin'), readHeader(bag, 'Referer')];
    expect(pair).toEqual([SPA_ORIGIN, SPA_ORIGIN]);
  });

  it('DHS-5 omits the header entirely when no donor and no pin exist', () => {
    const bag = buildBag([MARKETING_CAPTURE], API_HOST);
    const siteId = readHeader(bag, 'X-Site-Id');
    expect(siteId).toBe(ABSENT);
  });

  it('DHS-6 lets the pin win over a same-host sibling service donor', () => {
    const bag = buildBag([MARKETING_CAPTURE, API_CAPTURE], API_HOST, PINNED);
    const siteId = readHeader(bag, 'X-Site-Id');
    expect(siteId).toBe(API_SITE_ID);
  });

  it('DHS-6b overrides a discovered value that differs from the pin', () => {
    const winningPin = { 'X-Site-Id': 'pin-must-win' };
    const bag = buildBag([MARKETING_CAPTURE, API_CAPTURE], API_HOST, winningPin);
    const siteId = readHeader(bag, 'X-Site-Id');
    expect(siteId).toBe('pin-must-win');
  });

  it('DHS-7 leaves an unscoped bank on its pre-existing first-match behaviour', () => {
    const bag = buildBag([MARKETING_CAPTURE]);
    const siteId = readHeader(bag, 'X-Site-Id');
    expect(siteId).toBe(MARKETING_SITE_ID);
  });

  it('DHS-8 rejects a donor that merely mentions the API host in its query', () => {
    const lookalike = makeEndpoint(`https://www.cal-online.co.il/go?next=${API_HOST}`, {
      'x-site-id': MARKETING_SITE_ID,
    });
    const bag = buildBag([lookalike], API_HOST);
    const siteId = readHeader(bag, 'X-Site-Id');
    expect(siteId).toBe(ABSENT);
  });

  it('DHS-9 rejects a donor whose host merely ends with the API host as a prefix', () => {
    const lookalike = makeEndpoint(`https://${API_HOST}.attacker.test/init`, {
      'x-site-id': MARKETING_SITE_ID,
    });
    const bag = buildBag([lookalike], API_HOST);
    const siteId = readHeader(bag, 'X-Site-Id');
    expect(siteId).toBe(ABSENT);
  });

  it('DHS-10 accepts a genuine subdomain of the declared family', () => {
    const sub = makeEndpoint(`https://edge.${API_HOST}/Authentication/api/account/init`, {
      'x-site-id': API_SITE_ID,
    });
    const bag = buildBag([sub], API_HOST);
    const siteId = readHeader(bag, 'X-Site-Id');
    expect(siteId).toBe(API_SITE_ID);
  });

  it('DHS-11 treats a blank discovered value as unresolved and still pins', () => {
    const blank = makeEndpoint(`https://${API_HOST}/Authentication/api/account/init`, {
      'x-site-id': '   ',
    });
    const bag = buildBag([blank], API_HOST, PINNED);
    const siteId = readHeader(bag, 'X-Site-Id');
    expect(siteId).toBe(API_SITE_ID);
  });

  it('DHS-12 replaces a blank case-variant rather than sending both spellings', () => {
    const blank = makeEndpoint(`https://${API_HOST}/Authentication/api/account/init`, {
      'x-site-id': '',
    });
    const bag = buildBag([blank], API_HOST, PINNED);
    const spellings = Object.keys(bag).filter(k => k.toLowerCase() === 'x-site-id');
    expect(spellings).toHaveLength(1);
  });
});
