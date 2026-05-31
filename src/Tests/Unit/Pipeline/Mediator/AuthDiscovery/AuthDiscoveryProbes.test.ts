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
  probeDashboardSignal,
} from '../../../../../Scrapers/Pipeline/Mediator/AuthDiscovery/AuthDiscoveryProbes.js';
import type {
  ICookieSnapshot,
  IElementMediator,
} from '../../../../../Scrapers/Pipeline/Mediator/Elements/ElementMediator.js';
import type { INetworkDiscovery } from '../../../../../Scrapers/Pipeline/Mediator/Network/NetworkDiscoveryTypes.js';
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
