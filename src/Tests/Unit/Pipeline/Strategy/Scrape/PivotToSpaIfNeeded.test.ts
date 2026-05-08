/**
 * Phase 7d coverage support — exercises `pivotToSpaIfNeeded` and
 * its `isTxnHostedOnCurrentOrigin` / `logTxnEndpoint` helpers in
 * GenericAutoScrapeStrategy. The four-branch coverage matters
 * because each branch represents a distinct SPA-vs-API host
 * topology a real bank can present:
 *
 *   1. Network has no SPA url → no pivot.
 *   2. Current origin already matches SPA origin → no pivot.
 *   3. SPA origin differs but txn endpoint is on current origin
 *      already → no pivot (suffix-host edge case).
 *   4. SPA origin differs AND txn endpoint is elsewhere → pivot
 *      via `mediator.navigateTo`.
 *
 * Tests use FAKE URLs only (https://api.fake.example, etc.).
 */

import { EMPTY_TXN_HARVEST } from '../../../../../Scrapers/Pipeline/Mediator/Dashboard/TxnParser.js';
import type { IElementMediator } from '../../../../../Scrapers/Pipeline/Mediator/Elements/ElementMediator.js';
import type {
  IDiscoveredEndpoint,
  INetworkDiscovery,
} from '../../../../../Scrapers/Pipeline/Mediator/Network/NetworkDiscovery.js';
import {
  buildLoadCtxFromPreDiscovered,
  pivotToSpaIfNeeded,
} from '../../../../../Scrapers/Pipeline/Strategy/Scrape/GenericAutoScrapeStrategy.js';
import {
  EMPTY_TXN_ENDPOINT,
  type IAccountFetchCtx,
} from '../../../../../Scrapers/Pipeline/Strategy/Scrape/ScrapeTypes.js';
import type { ITxnEndpoint } from '../../../../../Scrapers/Pipeline/Types/PipelineContext.js';
import { isOk } from '../../../../../Scrapers/Pipeline/Types/Procedure.js';

/**
 * Build an inert IAccountFetchCtx stub. `buildLoadCtxFromPreDiscovered`
 * only spreads `fc` into the returned context — no fields are read in
 * the code paths exercised by these tests, so any IAccountFetchCtx-shaped
 * value satisfies the contract.
 * @returns Inert IAccountFetchCtx for tests that don't read it.
 */
function makeStubFetchCtx(): IAccountFetchCtx {
  return {
    api: {},
    network: {},
    startDate: '2026-01-01',
  } as unknown as IAccountFetchCtx;
}

/** Configuration for {@link makeNetwork}. */
interface INetworkStubArgs {
  readonly spaUrl: string | false;
  readonly txnEndpointUrl: string | false;
}

/**
 * Build a stub network discovery exposing the supplied SPA url and
 * txn endpoint url. Other surfaces return harmless defaults.
 * @param args - Stub configuration.
 * @returns Stub INetworkDiscovery.
 */
function makeNetwork(args: INetworkStubArgs): INetworkDiscovery {
  /**
   * Stub SPA url accessor.
   * @returns Configured SPA url.
   */
  const stubDiscoverSpaUrl = (): string | false => args.spaUrl;
  /**
   * Stub txn endpoint accessor; synthesises a minimal endpoint
   * object so the production helper's `new URL(ep.url)` call works.
   * @returns Stub endpoint or false.
   */
  const stubDiscoverTransactionsEndpoint = (): IDiscoveredEndpoint | false => {
    if (args.txnEndpointUrl === false) return false;
    return {
      url: args.txnEndpointUrl,
      method: 'POST',
      postData: '',
      contentType: 'application/json',
      requestHeaders: {},
      responseHeaders: {},
      responseBody: {},
      timestamp: 0,
    };
  };
  return {
    discoverSpaUrl: stubDiscoverSpaUrl,
    discoverTransactionsEndpoint: stubDiscoverTransactionsEndpoint,
  } as unknown as INetworkDiscovery;
}

/** Bundled stub mediator + observable navigation counter. */
interface IRecordingMediator {
  readonly mediator: IElementMediator;
  readonly navigations: { count: number; lastUrl: string };
}

/**
 * Build a slim {@link ITxnEndpoint} from a URL string, or return the
 * EMPTY default. Phase 7f: SCRAPE consumes the typed slim contract;
 * `false` is no longer valid — callers pass the EMPTY default to
 * signal "no endpoint".
 * @param url - Endpoint URL or false.
 * @returns Slim TXN endpoint stub.
 */
function makeStubTxnEndpoint(url: string | false): ITxnEndpoint {
  if (url === false) return EMPTY_TXN_ENDPOINT;
  return {
    ...EMPTY_TXN_ENDPOINT,
    url,
    method: 'POST',
  };
}

/**
 * Build a stub element mediator that records `navigateTo` calls.
 * @param currentUrl - URL the stub reports for getCurrentUrl.
 * @returns Recording mediator.
 */
function makeMediator(currentUrl: string): IRecordingMediator {
  const navigations = { count: 0, lastUrl: '' };
  /**
   * Stub navigateTo recorder.
   * @param url - Target URL.
   * @returns Resolved indicator after observation.
   */
  const stubNavigateTo = async (url: string): Promise<boolean> => {
    navigations.count += 1;
    navigations.lastUrl = url;
    await Promise.resolve();
    return true;
  };
  const mediator: IElementMediator = {
    /**
     * Stub URL accessor returning the configured currentUrl.
     * @returns The configured currentUrl.
     */
    getCurrentUrl: (): string => currentUrl,
    navigateTo: stubNavigateTo,
  } as unknown as IElementMediator;
  return { mediator, navigations };
}

describe('pivotToSpaIfNeeded — Phase 7e: txnEndpoint passed through args', () => {
  it('returns succeed(false) when network has no spaUrl (branch 1)', async () => {
    const network = makeNetwork({ spaUrl: false, txnEndpointUrl: false });
    const txnEndpoint = makeStubTxnEndpoint(false);
    const recording = makeMediator('https://api.fake.example/dashboard');
    const result = await pivotToSpaIfNeeded({ mediator: recording.mediator, network, txnEndpoint });
    const wasOk = isOk(result);
    expect(wasOk).toBe(true);
    if (isOk(result)) expect(result.value).toBe(false);
    expect(recording.navigations.count).toBe(0);
  });

  it('returns succeed(false) when current origin already matches SPA origin (branch 2)', async () => {
    const network = makeNetwork({
      spaUrl: 'https://spa.fake.example/app',
      txnEndpointUrl: 'https://api.fake.example/txns',
    });
    const txnEndpoint = makeStubTxnEndpoint('https://api.fake.example/txns');
    const recording = makeMediator('https://spa.fake.example/dashboard');
    const result = await pivotToSpaIfNeeded({ mediator: recording.mediator, network, txnEndpoint });
    const wasOk = isOk(result);
    expect(wasOk).toBe(true);
    if (isOk(result)) expect(result.value).toBe(false);
    expect(recording.navigations.count).toBe(0);
  });

  it('returns succeed(false) when txn endpoint is hosted on current origin (branch 3)', async () => {
    const network = makeNetwork({
      spaUrl: 'https://spa.fake.example/app',
      txnEndpointUrl: 'https://api.fake.example/txns',
    });
    const txnEndpoint = makeStubTxnEndpoint('https://api.fake.example/txns');
    const recording = makeMediator('https://api.fake.example/dashboard');
    const result = await pivotToSpaIfNeeded({ mediator: recording.mediator, network, txnEndpoint });
    const wasOk = isOk(result);
    expect(wasOk).toBe(true);
    if (isOk(result)) expect(result.value).toBe(false);
    expect(recording.navigations.count).toBe(0);
  });

  it('navigates to SPA when origins differ AND txn endpoint is elsewhere (branch 4)', async () => {
    const network = makeNetwork({
      spaUrl: 'https://spa.fake.example/app',
      txnEndpointUrl: 'https://other.fake.example/txns',
    });
    const txnEndpoint = makeStubTxnEndpoint('https://other.fake.example/txns');
    const recording = makeMediator('https://landing.fake.example/dashboard');
    const result = await pivotToSpaIfNeeded({ mediator: recording.mediator, network, txnEndpoint });
    const wasOk = isOk(result);
    expect(wasOk).toBe(true);
    if (isOk(result)) expect(result.value).toBe(true);
    expect(recording.navigations.count).toBe(1);
    expect(recording.navigations.lastUrl).toBe('https://spa.fake.example/app');
  });

  it('navigates when txn endpoint is unknown (false) and origins differ (branch 4 sibling)', async () => {
    const network = makeNetwork({
      spaUrl: 'https://spa.fake.example/app',
      txnEndpointUrl: false,
    });
    const txnEndpoint = makeStubTxnEndpoint(false);
    const recording = makeMediator('https://landing.fake.example/dashboard');
    const result = await pivotToSpaIfNeeded({ mediator: recording.mediator, network, txnEndpoint });
    const wasOk = isOk(result);
    expect(wasOk).toBe(true);
    if (isOk(result)) expect(result.value).toBe(true);
    expect(recording.navigations.count).toBe(1);
  });
});

describe('buildLoadCtxFromPreDiscovered — txn endpoint logging branches', () => {
  it('logs the picked txn endpoint when one is supplied', () => {
    const txnEndpoint = makeStubTxnEndpoint('https://api.fake.example/txns');
    const ctx = buildLoadCtxFromPreDiscovered({
      fc: makeStubFetchCtx(),
      txnEndpoint,
      harvest: EMPTY_TXN_HARVEST,
      ids: ['FAKE-ID-1'],
      records: [{ accountId: 'FAKE-ID-1' }],
    });
    expect(ctx.ids).toEqual(['FAKE-ID-1']);
    expect(ctx.txnEndpoint?.url).toBe('https://api.fake.example/txns');
  });

  it('logs the "none" branch when txnEndpoint url is empty (EMPTY default)', () => {
    const ctx = buildLoadCtxFromPreDiscovered({
      fc: makeStubFetchCtx(),
      txnEndpoint: EMPTY_TXN_ENDPOINT,
      harvest: EMPTY_TXN_HARVEST,
      ids: ['FAKE-ID-2'],
      records: [{ accountId: 'FAKE-ID-2' }],
    });
    expect(ctx.txnEndpoint?.url).toBe('');
  });
});
