/**
 * Unit tests for AuthDiscoveryProbes — internal helpers wrapping
 * cookie audit, network channel collection, and dashboard reveal.
 *
 * <p>The factory test
 * (`AuthDiscoveryFactoryTest.test.ts`) covers the public end-to-end
 * contract; this file pins the helper-level branches that the
 * factory does not exercise individually (cookies-throw,
 * network-helper-throws, fetchOpts=false fallback).
 */

import {
  auditSessionCookies,
  collectAuthChannels,
  hasCapturedAuthApi,
  probeDashboardSignal,
} from '../../../../../Scrapers/Pipeline/Mediator/AuthDiscovery/AuthDiscoveryProbes.js';
import type {
  ICookieSnapshot,
  IElementMediator,
} from '../../../../../Scrapers/Pipeline/Mediator/Elements/ElementMediator.js';
import type {
  IDiscoveredEndpoint,
  INetworkDiscovery,
} from '../../../../../Scrapers/Pipeline/Mediator/Network/NetworkDiscoveryTypes.js';
import type { IFetchOpts } from '../../../../../Scrapers/Pipeline/Strategy/Fetch/FetchStrategy.js';

const FAKE_COOKIE: ICookieSnapshot = {
  name: 'JSESSIONID',
  value: 'redacted',
  domain: 'example.bank',
  path: '/',
  expires: -1,
  httpOnly: true,
  secure: true,
  sameSite: 'None',
} as ICookieSnapshot;

describe('auditSessionCookies', () => {
  it('returns count + names for the supplied cookies', async () => {
    const mediator = {
      /**
       * Returns 2 cookies.
       * @returns Snapshots.
       */
      getCookies: (): Promise<readonly ICookieSnapshot[]> =>
        Promise.resolve([FAKE_COOKIE, { ...FAKE_COOKIE, name: 'PSEK' }]),
    } as unknown as IElementMediator;
    const audit = await auditSessionCookies(mediator);
    expect(audit.count).toBe(2);
    expect(audit.names).toEqual(['JSESSIONID', 'PSEK']);
  });

  it('treats a getCookies rejection as zero cookies', async () => {
    const mediator = {
      /**
       * Always rejects.
       * @returns Rejection.
       */
      getCookies: (): Promise<readonly ICookieSnapshot[]> =>
        Promise.reject(new Error('cookies-throw')),
    } as unknown as IElementMediator;
    const audit = await auditSessionCookies(mediator);
    expect(audit.count).toBe(0);
    expect(audit.names).toEqual([]);
  });
});

describe('collectAuthChannels', () => {
  it('collects all four channels from a healthy network surface', async () => {
    const fetchOpts: IFetchOpts = { extraHeaders: { 'X-Site-Id': '10' } };
    const network = {
      /**
       * Returns a fake bearer token.
       * @returns String.
       */
      discoverAuthToken: (): Promise<string> => Promise.resolve('fake-bearer'),
      /**
       * Returns a fake origin.
       * @returns String.
       */
      discoverOrigin: (): string => 'https://example.bank',
      /**
       * Returns a fake site id.
       * @returns String.
       */
      discoverSiteId: (): string => '10',
      /**
       * Returns a fake fetch-opts bag.
       * @returns IFetchOpts.
       */
      buildDiscoveredHeaders: (): Promise<IFetchOpts> => Promise.resolve(fetchOpts),
    } as unknown as INetworkDiscovery;
    const channels = await collectAuthChannels(network);
    expect(channels.authToken).toBe('fake-bearer');
    expect(channels.origin).toBe('https://example.bank');
    expect(channels.siteId).toBe('10');
    expect(channels.headers).toEqual({ 'X-Site-Id': '10' });
  });

  it('returns false channels and empty headers when every helper fails or returns false', async () => {
    const network = {
      /**
       * Rejects the token discovery.
       * @returns Rejection.
       */
      discoverAuthToken: (): Promise<never> => Promise.reject(new Error('token-throw')),
      /**
       * No origin.
       * @returns False.
       */
      discoverOrigin: (): false => false,
      /**
       * No site id.
       * @returns False.
       */
      discoverSiteId: (): false => false,
      /**
       * Rejects header building.
       * @returns Rejection.
       */
      buildDiscoveredHeaders: (): Promise<never> => Promise.reject(new Error('headers-throw')),
    } as unknown as INetworkDiscovery;
    const channels = await collectAuthChannels(network);
    expect(channels.authToken).toBe(false);
    expect(channels.origin).toBe(false);
    expect(channels.siteId).toBe(false);
    expect(channels.headers).toEqual({});
  });
});

describe('probeDashboardSignal', () => {
  it('returns dashboardReady=true when resolveVisible finds a candidate', async () => {
    const mediator = {
      /**
       * Resolve-visible returns a found candidate.
       * @returns Found result.
       */
      resolveVisible: (): Promise<unknown> =>
        Promise.resolve({
          found: true,
          candidate: { kind: 'textContent', value: 'יתרה' },
        }),
    } as unknown as IElementMediator;
    const result = await probeDashboardSignal(mediator);
    expect(result.dashboardReady).toBe(true);
    expect(result.revealString).toContain('reveal:');
  });

  it('returns dashboardReady=false when reveal probe finds nothing', async () => {
    const mediator = {
      /**
       * Resolve-visible returns no-found.
       * @returns Not-found result.
       */
      resolveVisible: (): Promise<unknown> => Promise.resolve({ found: false, candidate: false }),
    } as unknown as IElementMediator;
    const result = await probeDashboardSignal(mediator);
    expect(result.dashboardReady).toBe(false);
    expect(result.revealString).toBe('no reveal');
  });
});

/** Synthetic discovered endpoint matching the accounts pattern (`GetCardList`). */
const ACCOUNTS_ENDPOINT: IDiscoveredEndpoint = {
  url: 'https://web.isracard.co.il/api/GetCardList',
  method: 'GET',
  postData: '',
  responseBody: {},
  contentType: 'application/json',
  requestHeaders: {},
  responseHeaders: {},
  timestamp: 0,
  status: 200,
};

/**
 * Build a network surface whose findEndpoints() filters a fixed capture
 * pool by the supplied pattern — the faithful multi-match contract the
 * production probe relies on (an early non-2xx must not mask a later 2xx).
 * @param pool - Captured endpoints the fake network exposes.
 * @returns Network discovery stub backed by the pool.
 */
function makeNetwork(pool: readonly IDiscoveredEndpoint[]): INetworkDiscovery {
  return {
    /**
     * Return every pooled capture whose URL matches the pattern.
     * @param pattern - Accounts-bucket regex from the probe.
     * @returns Matching captures in pool order.
     */
    findEndpoints: (pattern: RegExp): readonly IDiscoveredEndpoint[] =>
      pool.filter((ep): boolean => pattern.test(ep.url)),
  } as unknown as INetworkDiscovery;
}

describe('hasCapturedAuthApi', () => {
  it('returns true when an accounts endpoint with status 200 is captured', () => {
    const network = makeNetwork([ACCOUNTS_ENDPOINT]);
    const hasAuth200 = hasCapturedAuthApi(network);
    expect(hasAuth200).toBe(true);
  });

  it('returns false for an analytics-only pool (no accounts match)', () => {
    const analytics: IDiscoveredEndpoint = { ...ACCOUNTS_ENDPOINT, url: 'https://x.co/collect' };
    const network = makeNetwork([analytics]);
    const hasAuthAnalytics = hasCapturedAuthApi(network);
    expect(hasAuthAnalytics).toBe(false);
  });

  it('returns false when the only accounts endpoint has a 401 status (not authed)', () => {
    const unauthedEndpoint: IDiscoveredEndpoint = { ...ACCOUNTS_ENDPOINT, status: 401 };
    const network = makeNetwork([unauthedEndpoint]);
    const hasAuth401 = hasCapturedAuthApi(network);
    expect(hasAuth401).toBe(false);
  });

  it('returns true when the accounts endpoint has undefined status (replay path)', () => {
    const replayEndpoint: IDiscoveredEndpoint = { ...ACCOUNTS_ENDPOINT, status: undefined };
    const network = makeNetwork([replayEndpoint]);
    const hasAuthReplay = hasCapturedAuthApi(network);
    expect(hasAuthReplay).toBe(true);
  });

  it('returns true on a later 200 even when an earlier 401 was captured first', () => {
    // R3-11 firing guard: an early failed retry must NOT mask a later authed
    // success on the same URL. RED on the prior discoverByPatterns (first-match)
    // code, which saw only the 401; GREEN on the findEndpoints `.some` scan.
    const early401: IDiscoveredEndpoint = { ...ACCOUNTS_ENDPOINT, status: 401, timestamp: 0 };
    const later200: IDiscoveredEndpoint = { ...ACCOUNTS_ENDPOINT, status: 200, timestamp: 1 };
    const network = makeNetwork([early401, later200]);
    const hasAuthAfterRetry = hasCapturedAuthApi(network);
    expect(hasAuthAfterRetry).toBe(true);
  });

  it('does NOT corroborate on a login-submission (auth-bucket) capture alone', () => {
    // RED #1 guard: `.auth` endpoints fire DURING login, so a capture
    // proves login was attempted — not that the dashboard was reached.
    // Only the `.accounts` (post-auth data) bucket corroborates. This is
    // RED on the prior `.auth`-fallback code, GREEN on the accounts-only fix.
    const authEndpoint: IDiscoveredEndpoint = {
      ...ACCOUNTS_ENDPOINT,
      url: 'https://bank.co.il/api/v2/auth/login',
    };
    const network = makeNetwork([authEndpoint]);
    const hasAuthBucketCorroboration = hasCapturedAuthApi(network);
    expect(hasAuthBucketCorroboration).toBe(false);
  });
});
