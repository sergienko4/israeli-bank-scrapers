/**
 * Branch-recovery coverage for NetworkDiscovery.ts.
 * Targets: findByReferer same-origin skip (L421), collectSourcedValues
 * dedupe branches (L729), pickBestValue 0/1-element/all-login paths
 * (L744-L749), formatTokenPreview NONE (L758), resolveOrigin empty
 * (L770), assembleDiscoveredHeaders origin/auth/siteId merge (L815-L823),
 * buildTxnUrlFromTraffic missing account split (L880), buildBalUrlFromTraffic
 * no-hit (L900).
 */

import type { Page, Response } from 'playwright-core';

import type { IDiscoveredEndpoint } from '../../../../../Scrapers/Pipeline/Mediator/Network/NetworkDiscovery.js';
import {
  createFrozenNetwork,
  createNetworkDiscovery,
} from '../../../../../Scrapers/Pipeline/Mediator/Network/NetworkDiscovery.js';

/** Registered response listeners — captured from page.on('response', fn). */
let listeners: ((r: Response) => boolean)[] = [];

/**
 * Build a mock Page that records response listeners and never resolves waits.
 * @param url - Page URL (default bank.co.il).
 * @returns Mock Page.
 */
function makeMockPage(url = 'https://bank.co.il'): Page {
  listeners = [];
  return {
    /**
     * Record response listener.
     * @param event - Event name.
     * @param fn - Listener.
     * @returns Empty page.
     */
    on: (event: string, fn: (r: Response) => boolean): Page => {
      if (event === 'response') listeners.push(fn);
      return {} as Page;
    },
    /**
     * Page URL.
     * @returns URL string.
     */
    url: (): string => url,
    /**
     * waitForResponse never resolves — interceptor fire-and-forget.
     * @returns Never-resolving.
     */
    waitForResponse: (): Promise<false> => Promise.race([]),
    /**
     * No iframes.
     * @returns Empty array.
     */
    frames: (): Page[] => [],
    /**
     * evaluate — returns empty.
     * @returns Resolved ''.
     */
    evaluate: (): Promise<string> => Promise.resolve(''),
  } as unknown as Page;
}

/** Options to simulate a captured response event. */
interface ISimOpts {
  readonly url: string;
  readonly body: Record<string, unknown>;
  readonly method?: string;
  readonly contentType?: string;
  readonly reqHeaders?: Record<string, string>;
  readonly resHeaders?: Record<string, string>;
}

/**
 * Simulate a response arriving at the recorded listener.
 * @param opts - Response options.
 * @returns Resolved after async parse.
 */
async function simulate(opts: ISimOpts): Promise<void> {
  const method = opts.method ?? 'GET';
  const contentType = opts.contentType ?? 'application/json';
  const resp = {
    /**
     * Response URL.
     * @returns URL.
     */
    url: (): string => opts.url,
    /**
     * HTTP status.
     * @returns 200.
     */
    status: (): number => 200,
    /**
     * Request.
     * @returns Inner request mock.
     */
    request: () => ({
      /**
       * HTTP method.
       * @returns Method.
       */
      method: (): string => method,
      /**
       * Request body.
       * @returns Empty.
       */
      postData: (): string => '',
      /**
       * Request headers.
       * @returns Provided or empty.
       */
      headers: (): Record<string, string> => opts.reqHeaders ?? {},
    }),
    /**
     * Response headers — content-type merged with provided.
     * @returns Headers map.
     */
    headers: (): Record<string, string> => ({
      'content-type': contentType,
      ...(opts.resHeaders ?? {}),
    }),
    /**
     * Response body as JSON string.
     * @returns Resolved JSON text.
     */
    text: (): Promise<string> => {
      const bodyJson = JSON.stringify(opts.body);
      return Promise.resolve(bodyJson);
    },
  } as unknown as Response;
  listeners.forEach(fn => {
    fn(resp);
  });
  // Flush microtasks: parseResponse awaits response.text() then runs .then.
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}

describe('NetworkDiscovery — buildTransactionUrl / buildBalanceUrl branches (L880, L900)', () => {
  it('buildTransactionUrl returns false when captured URL does not contain account id', async () => {
    const page = makeMockPage();
    const discovery = createNetworkDiscovery(page);
    // URL matches no account id → findUrlWithAccountId returns false.
    await simulate({
      url: 'https://api.bank.co.il/lastTransactions/0/999',
      body: {},
    });
    const txnUrl = discovery.buildTransactionUrl('ACCT-NOT-IN-URL', '20250101');
    expect(txnUrl).toBe(false);
  });

  it('buildTransactionUrl builds full URL when account id present', async () => {
    const page = makeMockPage();
    const discovery = createNetworkDiscovery(page);
    await simulate({
      url: 'https://api.bank.co.il/gw/lastTransactions/12345/Date?FromDate=20240101',
      body: {},
    });
    const txnUrl = discovery.buildTransactionUrl('12345', '20250101');
    expect(typeof txnUrl).toBe('string');
    if (typeof txnUrl === 'string') {
      expect(txnUrl).toContain('12345');
      expect(txnUrl).toContain('FromDate=20250101');
    }
  });

  it('buildBalanceUrl returns false when no balance endpoint captured', () => {
    const page = makeMockPage();
    const discovery = createNetworkDiscovery(page);
    const balUrl = discovery.buildBalanceUrl('12345');
    expect(balUrl).toBe(false);
  });

  it('buildBalanceUrl substitutes trailing-digit segment with account id', async () => {
    const page = makeMockPage();
    const discovery = createNetworkDiscovery(page);
    await simulate({
      url: 'https://api.bank.co.il/infoAndBalance/99999',
      body: {},
    });
    const balUrl = discovery.buildBalanceUrl('77777');
    expect(balUrl).toBe('https://api.bank.co.il/infoAndBalance/77777');
  });

  it('buildBalanceUrl appends account id when last segment is not numeric', async () => {
    const page = makeMockPage();
    const discovery = createNetworkDiscovery(page);
    await simulate({
      url: 'https://api.bank.co.il/infoAndBalance',
      body: {},
    });
    const balUrl = discovery.buildBalanceUrl('77777');
    expect(balUrl).toBe('https://api.bank.co.il/infoAndBalance/77777');
  });
});

describe('NetworkDiscovery — findCommonServicesUrl edges (L200, L251, L281)', () => {
  it('getServicesUrl returns false when no endpoints captured (L200 guard)', () => {
    const page = makeMockPage();
    const discovery = createNetworkDiscovery(page);
    const url = discovery.getServicesUrl();
    expect(url).toBe(false);
  });

  it('discoverTransactionsEndpoint returns shape-pass over plain-url match', async () => {
    const page = makeMockPage();
    const discovery = createNetworkDiscovery(page);
    // First: URL matches but body lacks transactions array.
    await simulate({
      url: 'https://api.bank.co.il/lastTransactions/1',
      body: { notTxnsArray: true },
    });
    const hit = discovery.discoverTransactionsEndpoint();
    // urlMatches.length > 0, shapePass undefined → falls to urlMatches[0].
    expect(hit).not.toBe(false);
  });

  it('discoverByPatterns returns false when no pattern matches any captured URL (L281)', async () => {
    const page = makeMockPage();
    const discovery = createNetworkDiscovery(page);
    await simulate({ url: 'https://api.bank.co.il/unrelated', body: {} });
    const hit = discovery.discoverByPatterns([/never-matches-xyz/i]);
    expect(hit).toBe(false);
  });
});

describe('NetworkDiscovery — createFrozenNetwork header branches', () => {
  it('frozen buildDiscoveredHeaders includes Origin when request header present', async () => {
    const endpoints: IDiscoveredEndpoint[] = [
      {
        url: 'https://api.bank.co.il/x',
        method: 'GET',
        postData: '',
        contentType: 'application/json',
        requestHeaders: { origin: 'https://spa.bank.co.il' },
        responseHeaders: {},
        responseBody: {},
        timestamp: 0,
      },
    ];
    const frozen = createFrozenNetwork(endpoints, false);
    const opts = await frozen.buildDiscoveredHeaders();
    expect(opts.extraHeaders.Origin).toBe('https://spa.bank.co.il');
    expect(opts.extraHeaders.Referer).toBe('https://spa.bank.co.il');
  });

  it('frozen buildDiscoveredHeaders includes X-Site-Id when request header present', async () => {
    const endpoints: IDiscoveredEndpoint[] = [
      {
        url: 'https://api.bank.co.il/x',
        method: 'GET',
        postData: '',
        contentType: 'application/json',
        requestHeaders: { 'x-site-id': 'SITE-5' },
        responseHeaders: {},
        responseBody: {},
        timestamp: 0,
      },
    ];
    const frozen = createFrozenNetwork(endpoints, false);
    const opts = await frozen.buildDiscoveredHeaders();
    expect(opts.extraHeaders['X-Site-Id']).toBe('SITE-5');
  });

  it('frozen buildDiscoveredHeaders omits headers when none captured', async () => {
    const frozen = createFrozenNetwork([], false);
    const opts = await frozen.buildDiscoveredHeaders();
    expect(opts.extraHeaders.Origin).toBeUndefined();
    expect(opts.extraHeaders['X-Site-Id']).toBeUndefined();
    expect(opts.extraHeaders.authorization).toBeUndefined();
  });
});
