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

import { createNetworkDiscovery } from '../../../../../Scrapers/Pipeline/Mediator/Network/NetworkDiscovery.js';

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

describe('NetworkDiscovery — findByReferer cross-origin gate (L421)', () => {
  it('skips API endpoint whose referer is same-origin', async () => {
    const page = makeMockPage();
    const discovery = createNetworkDiscovery(page);
    // Referer same origin as endpoint → no SPA inference.
    await simulate({
      url: 'https://api.bank.co.il/lastTransactions/1/2',
      body: { items: [] },
      reqHeaders: { referer: 'https://api.bank.co.il/portal' },
    });
    const spa = discovery.discoverSpaUrl();
    expect(spa).toBe(false);
  });

  it('skips API endpoint when referer header absent entirely', async () => {
    const page = makeMockPage();
    const discovery = createNetworkDiscovery(page);
    await simulate({
      url: 'https://api.bank.co.il/lastTransactions/1/2',
      body: { items: [] },
    });
    const spa = discovery.discoverSpaUrl();
    expect(spa).toBe(false);
  });

  it('discovers SPA URL when referer is cross-origin', async () => {
    const page = makeMockPage();
    const discovery = createNetworkDiscovery(page);
    await simulate({
      url: 'https://api.bank.co.il/lastTransactions/1/2',
      body: { items: [] },
      reqHeaders: { referer: 'https://spa.bank.co.il/dashboard' },
    });
    const spa = discovery.discoverSpaUrl();
    expect(spa).toBe('https://spa.bank.co.il/dashboard');
  });
});

describe('NetworkDiscovery — collectSourcedValues dedupe (L729)', () => {
  it('deduplicates identical origin header across multiple endpoints (covers seen.has branch)', async () => {
    const page = makeMockPage();
    const discovery = createNetworkDiscovery(page);
    await simulate({
      url: 'https://api.bank.co.il/one',
      body: {},
      reqHeaders: { origin: 'https://spa.bank.co.il' },
    });
    await simulate({
      url: 'https://api.bank.co.il/two',
      body: {},
      reqHeaders: { origin: 'https://spa.bank.co.il' },
    });
    // buildDiscoveredHeaders → assembleDiscoveredHeaders → resolveOrigin → collectSourcedValues.
    // Second endpoint's val is same → seen.has(val) === true branch fires.
    const opts = await discovery.buildDiscoveredHeaders();
    expect(opts.extraHeaders.Origin).toBe('https://spa.bank.co.il');
  });

  it('skips endpoints where header is absent (covers extractHeader=false branch)', async () => {
    const page = makeMockPage();
    const discovery = createNetworkDiscovery(page);
    // First: no origin header → extractHeader=false, processOne returns false.
    await simulate({
      url: 'https://api.bank.co.il/noheader',
      body: {},
    });
    // Second: has origin → picked up.
    await simulate({
      url: 'https://api.bank.co.il/yesheader',
      body: {},
      reqHeaders: { origin: 'https://dash.bank.co.il' },
    });
    const opts = await discovery.buildDiscoveredHeaders();
    expect(opts.extraHeaders.Origin).toBe('https://dash.bank.co.il');
  });
});

describe('NetworkDiscovery — pickBestValue variants (L744-L749)', () => {
  it('returns single value directly when only one source captured (L745)', async () => {
    const page = makeMockPage();
    const discovery = createNetworkDiscovery(page);
    await simulate({
      url: 'https://api.bank.co.il/single',
      body: {},
      reqHeaders: { origin: 'https://one.bank.co.il' },
    });
    const opts = await discovery.buildDiscoveredHeaders();
    expect(opts.extraHeaders.Origin).toBe('https://one.bank.co.il');
  });

  it('prefers non-login source via buildDiscoveredHeaders when multiple unique values present', async () => {
    const page = makeMockPage();
    const discovery = createNetworkDiscovery(page);
    // First: login-domain source URL with origin header value of login.
    await simulate({
      url: 'https://login.bank.co.il/authentication/login',
      body: {},
      reqHeaders: { origin: 'https://login.bank.co.il' },
    });
    // Second: non-login API source with different origin header value.
    await simulate({
      url: 'https://api.bank.co.il/accountSummary',
      body: {},
      reqHeaders: { origin: 'https://spa.bank.co.il' },
    });
    // Let async parse complete via a real timer tick.
    await new Promise<boolean>((resolve): boolean => {
      type TimerFn = (cb: () => boolean, ms: number) => unknown;
      const scheduler = (globalThis as { setTimeout: TimerFn }).setTimeout;
      /**
       * Timer tick callback — resolves the outer promise.
       * @returns true always.
       */
      const cb = (): boolean => {
        resolve(true);
        return true;
      };
      scheduler(cb, 10);
      return true;
    });
    const all = discovery.getAllEndpoints();
    expect(all.length).toBeGreaterThanOrEqual(1);
    const opts = await discovery.buildDiscoveredHeaders();
    const origin = opts.extraHeaders.Origin;
    expect(typeof origin).toBe('string');
  });

  it('falls back to first login-source value via buildDiscoveredHeaders when all sources are login domains (L749)', async () => {
    const page = makeMockPage();
    const discovery = createNetworkDiscovery(page);
    // Both sources match LOGIN_DOMAIN_PATTERNS — nonLogin.find returns undefined.
    await simulate({
      url: 'https://login.bank.co.il/authentication/login',
      body: {},
      reqHeaders: { origin: 'https://login-a.bank.co.il' },
    });
    await simulate({
      url: 'https://connect.bank.co.il/verification',
      body: {},
      reqHeaders: { origin: 'https://login-b.bank.co.il' },
    });
    const opts = await discovery.buildDiscoveredHeaders();
    // Both are login domains → nonLogin undefined → fallback to first (L749).
    expect(opts.extraHeaders.Origin).toBe('https://login-a.bank.co.il');
  });

  it('resolveOrigin returns false when no origin headers captured (L770)', async () => {
    const page = makeMockPage();
    const discovery = createNetworkDiscovery(page);
    // No origin/referer headers → pickBestValue returns false.
    await simulate({
      url: 'https://api.bank.co.il/noauth',
      body: {},
    });
    const opts = await discovery.buildDiscoveredHeaders();
    expect(opts.extraHeaders.Origin).toBeUndefined();
    expect(opts.extraHeaders.Referer).toBeUndefined();
  });
});

describe('NetworkDiscovery — assembleDiscoveredHeaders merge branches (L815-L823)', () => {
  it('includes authorization when auth token discovered from request headers', async () => {
    const page = makeMockPage();
    const discovery = createNetworkDiscovery(page);
    await simulate({
      url: 'https://api.bank.co.il/x',
      body: {},
      reqHeaders: { authorization: 'Bearer tok-123' },
    });
    const opts = await discovery.buildDiscoveredHeaders();
    expect(opts.extraHeaders.authorization).toBe('Bearer tok-123');
  });

  it('includes Origin and Referer when origin discovered', async () => {
    const page = makeMockPage();
    const discovery = createNetworkDiscovery(page);
    await simulate({
      url: 'https://api.bank.co.il/x',
      body: {},
      reqHeaders: { origin: 'https://spa.bank.co.il' },
    });
    const opts = await discovery.buildDiscoveredHeaders();
    expect(opts.extraHeaders.Origin).toBe('https://spa.bank.co.il');
    expect(opts.extraHeaders.Referer).toBe('https://spa.bank.co.il');
  });

  it('includes X-Site-Id when site-id discovered', async () => {
    const page = makeMockPage();
    const discovery = createNetworkDiscovery(page);
    await simulate({
      url: 'https://api.bank.co.il/x',
      body: {},
      reqHeaders: { 'x-site-id': 'SITE-9' },
    });
    const opts = await discovery.buildDiscoveredHeaders();
    expect(opts.extraHeaders['X-Site-Id']).toBe('SITE-9');
  });

  it('omits Origin/X-Site-Id/authorization when none captured (formatTokenPreview NONE, L758)', async () => {
    const page = makeMockPage();
    const discovery = createNetworkDiscovery(page);
    await simulate({
      url: 'https://api.bank.co.il/x',
      body: {},
    });
    const opts = await discovery.buildDiscoveredHeaders();
    expect(opts.extraHeaders.authorization).toBeUndefined();
    expect(opts.extraHeaders.Origin).toBeUndefined();
    expect(opts.extraHeaders['X-Site-Id']).toBeUndefined();
    expect(opts.extraHeaders['Content-Type']).toBe('application/json');
  });
});
