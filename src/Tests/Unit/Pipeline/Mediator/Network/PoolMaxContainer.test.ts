/**
 * Phase 7b — `poolMaxContainer` scoring helper.
 *
 * Returns the largest WK named-container size seen across the pool.
 * Drives the fail-loud `ACCOUNT_RESOLUTION_INCOMPLETE` guard in
 * ACCOUNT-RESOLVE.POST: the resolved id count must not be lower
 * than this value.
 */

import { poolMaxContainer } from '../../../../../Scrapers/Pipeline/Mediator/Network/AccountFromPool.js';
import type { IDiscoveredEndpoint } from '../../../../../Scrapers/Pipeline/Mediator/Network/NetworkDiscoveryTypes.js';

/** Args for `makeCapture`. */
interface IMakeCaptureArgs {
  readonly url: string;
  readonly responseBody: unknown;
}

/**
 * Builds a synthetic discovered endpoint.
 * @param args - Capture args.
 * @returns Synthetic IDiscoveredEndpoint.
 */
function makeCapture(args: IMakeCaptureArgs): IDiscoveredEndpoint {
  return {
    url: args.url,
    method: 'GET',
    postData: '',
    responseBody: args.responseBody,
    contentType: 'application/json',
    requestHeaders: {},
    responseHeaders: {},
    timestamp: 100,
  };
}

describe('poolMaxContainer', () => {
  it('returns 0 on empty pool', () => {
    const max = poolMaxContainer([]);
    expect(max).toBe(0);
  });

  it('returns 0 when no endpoint exposes a named container', () => {
    const noise = makeCapture({
      url: 'https://api.bank.example/marketing',
      responseBody: { promotion: 'hello' },
    });
    const max = poolMaxContainer([noise]);
    expect(max).toBe(0);
  });

  it('returns max across multiple endpoints with containers (1 vs 8)', () => {
    const small = makeCapture({
      url: 'https://api.bank.example/directDebit',
      responseBody: { data: { cards: [{ cardNumber: '8912' }] } },
    });
    const big = makeCapture({
      url: 'https://api.bank.example/cardList',
      responseBody: {
        data: {
          cardsList: [
            { cardSuffix: '8912', accountNumber: '228812' },
            { cardSuffix: '9921', accountNumber: '248480' },
            { cardSuffix: '0786', accountNumber: '203489' },
            { cardSuffix: '1314', accountNumber: '228812' },
            { cardSuffix: '6440', accountNumber: '515331' },
            { cardSuffix: '5290', accountNumber: '228812' },
            { cardSuffix: '5167', accountNumber: '190691' },
            { cardSuffix: '0734', accountNumber: '66028' },
          ],
        },
      },
    });
    const max = poolMaxContainer([small, big]);
    expect(max).toBe(8);
  });

  it('order-agnostic — same result regardless of capture order', () => {
    const small = makeCapture({
      url: 'https://api.bank.example/small',
      responseBody: { data: { cards: [{ cardNumber: '1' }] } },
    });
    const big = makeCapture({
      url: 'https://api.bank.example/big',
      responseBody: {
        data: {
          cardsList: [
            { cardSuffix: '1', accountNumber: 'A' },
            { cardSuffix: '2', accountNumber: 'B' },
            { cardSuffix: '3', accountNumber: 'C' },
          ],
        },
      },
    });
    const fwd = poolMaxContainer([small, big]);
    const rev = poolMaxContainer([big, small]);
    expect(fwd).toBe(3);
    expect(rev).toBe(3);
  });

  it('counts only records that pass looksLikeAccountRecord — no card-shaped fields ignored', () => {
    const noiseContainer = makeCapture({
      url: 'https://api.bank.example/cards-but-empty',
      responseBody: {
        cardsList: [{ unrelated: 'no-id-field' }],
      },
    });
    const max = poolMaxContainer([noiseContainer]);
    expect(max).toBe(0);
  });
});
