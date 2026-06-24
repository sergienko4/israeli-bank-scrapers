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

describe('hasCapturedAuthApi', () => {
  it('returns true when discoverByPatterns finds an accounts endpoint with status 200', () => {
    const network = {
      /**
       * Returns a synthetic accounts endpoint.
       * @returns Accounts endpoint.
       */
      discoverByPatterns: (): IDiscoveredEndpoint => ACCOUNTS_ENDPOINT,
    } as unknown as INetworkDiscovery;
    const hasAuth200 = hasCapturedAuthApi(network);
    expect(hasAuth200).toBe(true);
  });

  it('returns false when discoverByPatterns returns false (analytics-only pool)', () => {
    const network = {
      /**
       * No matching endpoint in analytics-only pool.
       * @returns False.
       */
      discoverByPatterns: (): false => false,
    } as unknown as INetworkDiscovery;
    const hasAuthAnalytics = hasCapturedAuthApi(network);
    expect(hasAuthAnalytics).toBe(false);
  });

  it('returns false when the accounts endpoint has a 401 status (not authed)', () => {
    const unauthedEndpoint: IDiscoveredEndpoint = { ...ACCOUNTS_ENDPOINT, status: 401 };
    let callCount = 0;
    const network = {
      /**
       * Returns a 401 endpoint on first call (accounts), false on second (auth).
       * @returns Endpoint or false.
       */
      discoverByPatterns: (): IDiscoveredEndpoint | false => {
        callCount += 1;
        return callCount === 1 ? unauthedEndpoint : false;
      },
    } as unknown as INetworkDiscovery;
    const hasAuth401 = hasCapturedAuthApi(network);
    expect(hasAuth401).toBe(false);
  });

  it('returns true when accounts returns false but auth endpoint has undefined status (replay path)', () => {
    const authEndpoint: IDiscoveredEndpoint = {
      ...ACCOUNTS_ENDPOINT,
      url: 'https://bank.co.il/api/v2/auth/login',
      status: undefined,
    };
    let callCount = 0;
    const network = {
      /**
       * Returns false for accounts, auth endpoint (no status) for auth.
       * @returns False or auth endpoint.
       */
      discoverByPatterns: (): IDiscoveredEndpoint | false => {
        callCount += 1;
        return callCount === 1 ? false : authEndpoint;
      },
    } as unknown as INetworkDiscovery;
    const hasAuthReplay = hasCapturedAuthApi(network);
    expect(hasAuthReplay).toBe(true);
  });
});
