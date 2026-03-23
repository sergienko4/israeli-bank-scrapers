/**
 * Unit tests for NetworkDiscovery — captures API traffic from browser page.
 * Tests endpoint capture, filtering, pattern matching, and services URL discovery.
 */

import type { Page, Response } from 'playwright-core';

import type { INetworkDiscovery } from '../../../../Scrapers/Pipeline/Mediator/NetworkDiscovery.js';
import { createNetworkDiscovery } from '../../../../Scrapers/Pipeline/Mediator/NetworkDiscovery.js';

// ── Mock Page ────────────────────────────────────────────

/** Captured response listener from page.on('response', ...). */
type ResponseListener = (response: Response) => boolean;

/** Registered listeners from page.on(). */
let capturedListeners: ResponseListener[] = [];

/**
 * Build a mock page that captures response listeners.
 * @returns Mock page with on() and url().
 */
function makeMockPage(): Page {
  capturedListeners = [];
  const self = {
    /**
     * Register event listener — captures 'response' listeners.
     * @param event - Event name.
     * @param fn - Listener function.
     * @returns Self for chaining.
     */
    on: (event: string, fn: ResponseListener): Page => {
      if (event === 'response') capturedListeners.push(fn);
      return self as unknown as Page;
    },
    /**
     * Return page URL.
     * @returns Mock URL.
     */
    url: (): string => 'https://test.bank.co.il',
  };
  return self as unknown as Page;
}

/** Options for simulating a response. */
interface ISimulateOpts {
  readonly url: string;
  readonly body: Record<string, unknown>;
  readonly method?: string;
  readonly postData?: string;
  readonly contentType?: string;
}

/**
 * Simulate a response event and wait for async parsing.
 * @param opts - Response simulation options.
 * @returns Promise that resolves after capture completes.
 */
async function simulateResponse(opts: ISimulateOpts): Promise<boolean> {
  const method = opts.method ?? 'GET';
  const postData = opts.postData ?? '';
  const contentType = opts.contentType ?? 'application/json';
  const response = {
    /**
     * Response URL.
     * @returns URL string.
     */
    url: (): string => opts.url,
    /**
     * HTTP status.
     * @returns 200.
     */
    status: (): number => 200,
    /**
     * Request info.
     * @returns Request mock.
     */
    request: (): { method: () => string; postData: () => string } => ({
      /**
       * HTTP method.
       * @returns Method string.
       */
      method: (): string => method,
      /**
       * POST body.
       * @returns Post data string.
       */
      postData: (): string => postData,
    }),
    /**
     * Response headers.
     * @returns Headers object.
     */
    headers: (): Record<string, string> => ({ 'content-type': contentType }),
    /**
     * Response body text.
     * @returns Resolved JSON string.
     */
    text: (): Promise<string> => {
      const json = JSON.stringify(opts.body);
      return Promise.resolve(json);
    },
  } as unknown as Response;
  capturedListeners.forEach(fn => {
    fn(response);
  });
  // Wait for async parseResponse to complete
  await Promise.resolve();
  await Promise.resolve();
  return true;
}

// ── Tests ────────────────────────────────────────────────

describe('NetworkDiscovery', () => {
  let discovery: INetworkDiscovery;

  beforeEach(() => {
    const page = makeMockPage();
    discovery = createNetworkDiscovery(page);
  });

  describe('startCapture', () => {
    it('registers a response listener on the page', () => {
      expect(capturedListeners.length).toBeGreaterThan(0);
    });
  });

  describe('capture + findEndpoints', () => {
    it('captures JSON API responses', async () => {
      await simulateResponse({
        url: 'https://api.bank.co.il/services/Handler?reqName=DashboardMonth',
        body: { Header: { Status: '1' } },
      });
      const endpoints = discovery.findEndpoints(/DashboardMonth/);
      expect(endpoints.length).toBe(1);
      expect(endpoints[0].url).toContain('DashboardMonth');
    });

    it('ignores non-JSON responses (HTML)', async () => {
      await simulateResponse({
        url: 'https://bank.co.il/login',
        body: {},
        contentType: 'text/html',
      });
      const endpoints = discovery.findEndpoints(/login/);
      expect(endpoints.length).toBe(0);
    });

    it('filters endpoints by URL regex', async () => {
      await simulateResponse({
        url: 'https://api.bank.co.il?reqName=DashboardMonth',
        body: { data: 1 },
      });
      await simulateResponse({
        url: 'https://api.bank.co.il?reqName=CardsList',
        body: { data: 2 },
      });
      await simulateResponse({
        url: 'https://api.bank.co.il?reqName=UserProfile',
        body: { data: 3 },
      });
      const dashboard = discovery.findEndpoints(/DashboardMonth/);
      expect(dashboard.length).toBe(1);
      const cards = discovery.findEndpoints(/CardsList/);
      expect(cards.length).toBe(1);
    });

    it('captures POST method', async () => {
      await simulateResponse({
        url: 'https://api.bank.co.il?reqName=ValidateIdData',
        body: { returnCode: '1' },
        method: 'POST',
        postData: 'id=123',
      });
      const endpoints = discovery.findEndpoints(/ValidateIdData/);
      expect(endpoints.length).toBe(1);
      expect(endpoints[0].method).toBe('POST');
    });
  });

  describe('getServicesUrl', () => {
    it('extracts common base URL from captured endpoints', async () => {
      await simulateResponse({
        url: 'https://he.amex.co.il/services/Handler?reqName=A',
        body: { a: 1 },
      });
      await simulateResponse({
        url: 'https://he.amex.co.il/services/Handler?reqName=B',
        body: { b: 2 },
      });
      const servicesUrl = discovery.getServicesUrl();
      expect(servicesUrl).toContain('he.amex.co.il/services/Handler');
    });

    it('returns false when no endpoints captured', () => {
      const servicesUrl = discovery.getServicesUrl();
      expect(servicesUrl).toBe(false);
    });
  });

  describe('getAllEndpoints', () => {
    it('returns all captured endpoints', async () => {
      await simulateResponse({ url: 'https://api.bank.co.il/a', body: { a: 1 } });
      await simulateResponse({ url: 'https://api.bank.co.il/b', body: { b: 2 } });
      const all = discovery.getAllEndpoints();
      expect(all.length).toBe(2);
    });
  });
});
