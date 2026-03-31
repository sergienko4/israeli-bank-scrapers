/**
 * Unit tests for Phase 17: Zero-Registry Proxy Discovery.
 * Verifies signature-based template matching from NetworkStore.
 * Rule #9: Tests first, then code.
 */

import type { IDiscoveredEndpoint } from '../../../../../Scrapers/Pipeline/Mediator/NetworkDiscoveryTypes.js';
import {
  findProxyAccountTemplate,
  findProxyTxnTemplate,
} from '../../../../../Scrapers/Pipeline/Phases/ScrapePhase.js';

/** Whether a template was discovered. */
type WasDiscovered = boolean;

/**
 * Build a mock endpoint.
 * @param url - Endpoint URL.
 * @param responseBody - Parsed JSON body.
 * @returns Mock IDiscoveredEndpoint.
 */
function mockEp(url: string, responseBody: unknown): IDiscoveredEndpoint {
  return {
    url,
    method: 'GET',
    postData: '',
    responseBody,
    contentType: 'text/html',
    requestHeaders: {},
    timestamp: Date.now(),
  };
}

describe('findProxyAccountTemplate', () => {
  it('finds endpoint with billing/card signature keys', () => {
    const endpoints: readonly IDiscoveredEndpoint[] = [
      mockEp('https://he.example.co.il/services/ProxyRequestHandler.ashx?reqName=KodeyEretz', {}),
      mockEp('https://he.example.co.il/services/ProxyRequestHandler.ashx?reqName=DashboardMonth', {
        DashboardMonthBean: { cardsCharges: [{ cardNumber: '1234', billingDate: '2026-03-01' }] },
      }),
    ];
    const result = findProxyAccountTemplate(endpoints);
    const wasFound: WasDiscovered = result !== false;
    expect(wasFound).toBe(true);
    if (result) {
      const hasReqName: WasDiscovered = result.url.includes('DashboardMonth');
      expect(hasReqName).toBe(true);
    }
  });

  it('returns false when no account signature found', () => {
    const endpoints: readonly IDiscoveredEndpoint[] = [
      mockEp('https://he.example.co.il/services/ProxyRequestHandler.ashx?reqName=KodeyEretz', {
        countries: [{ code: 'IL' }],
      }),
    ];
    const result = findProxyAccountTemplate(endpoints);
    const wasFound: WasDiscovered = result !== false;
    expect(wasFound).toBe(false);
  });
});

describe('findProxyTxnTemplate', () => {
  it('finds endpoint with amount/description signature keys', () => {
    const endpoints: readonly IDiscoveredEndpoint[] = [
      mockEp(
        'https://he.example.co.il/services/ProxyRequestHandler.ashx?reqName=CardsTransactionsList',
        {
          CardsTransactionsListBean: [
            { fullPurchaseDate: '2026-03-01', originalAmount: 100, description: 'Test' },
          ],
        },
      ),
    ];
    const result = findProxyTxnTemplate(endpoints);
    const wasFound: WasDiscovered = result !== false;
    expect(wasFound).toBe(true);
  });

  it('returns false when no transaction signature found', () => {
    const endpoints: readonly IDiscoveredEndpoint[] = [
      mockEp('https://he.example.co.il/services/ProxyRequestHandler.ashx?reqName=DashboardMonth', {
        DashboardMonthBean: { billingDate: '2026-03-01' },
      }),
    ];
    const result = findProxyTxnTemplate(endpoints);
    const wasFound: WasDiscovered = result !== false;
    expect(wasFound).toBe(false);
  });
});
