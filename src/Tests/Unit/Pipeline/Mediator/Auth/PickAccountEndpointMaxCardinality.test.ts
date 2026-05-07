/**
 * Phase 7b — `pickAccountEndpoint` max-cardinality contract.
 *
 * Tested indirectly through `discoverAccountsInPool` (the picker is
 * not exported). The picker must return the endpoint exposing the
 * LARGEST WK named container reachable across the pool, with stable
 * tie-break on metadata richness then capture order.
 *
 * Background: pre-Phase-7b, the picker was first-match-wins, which
 * silently dropped 7 of 8 Amex cards because `GetDirectDebitList`
 * (1 card) fired before `GetCardList` (8 cards). Manual probes on
 * 2026-05-07 confirmed the same trap on Isracard.
 */

import { discoverAccountsInPool } from '../../../../../Scrapers/Pipeline/Mediator/Auth/AccountDiscovery.js';
import type { IDiscoveredEndpoint } from '../../../../../Scrapers/Pipeline/Mediator/Network/NetworkDiscoveryTypes.js';

/** Args for `makeCapture`. */
interface IMakeCaptureArgs {
  readonly url: string;
  readonly method: 'GET' | 'POST';
  readonly responseBody: unknown;
  readonly captureIndex?: number;
  readonly timestamp?: number;
}

/**
 * Builds a synthetic discovered endpoint.
 * @param args - Capture args.
 * @returns Synthetic IDiscoveredEndpoint.
 */
function makeCapture(args: IMakeCaptureArgs): IDiscoveredEndpoint {
  return {
    url: args.url,
    method: args.method,
    postData: '',
    responseBody: args.responseBody,
    contentType: 'application/json',
    requestHeaders: {},
    responseHeaders: {},
    timestamp: args.timestamp ?? 100,
    captureIndex: args.captureIndex ?? 0,
  };
}

describe('pickAccountEndpoint — max-cardinality contract (Phase 7b)', () => {
  it('Amex pattern: 1-card DirectDebit FIRST, 8-card CardList SECOND → picks 8-card', () => {
    const directDebit = makeCapture({
      url: 'https://web.americanexpress.example/ocp/.../GetDirectDebitList',
      method: 'GET',
      captureIndex: 162,
      responseBody: {
        data: { cards: [{ cardNumber: '8912', isActive: true }] },
      },
    });
    const cardList = makeCapture({
      url: 'https://web.americanexpress.example/ocp/.../GetCardList',
      method: 'POST',
      captureIndex: 163,
      responseBody: {
        data: {
          cardsList: [
            { cardSuffix: '8912', accountNumber: '228812', cardName: 'Gold' },
            { cardSuffix: '9921', accountNumber: '248480', cardName: 'Gold' },
            { cardSuffix: '0786', accountNumber: '203489', cardName: 'Plat' },
            { cardSuffix: '1314', accountNumber: '228812', cardName: 'Corp' },
            { cardSuffix: '6440', accountNumber: '515331', cardName: 'Plat' },
            { cardSuffix: '5290', accountNumber: '228812', cardName: 'Plat' },
            { cardSuffix: '5167', accountNumber: '190691', cardName: 'Plat' },
            { cardSuffix: '0734', accountNumber: '66028', cardName: 'Plat' },
          ],
        },
      },
    });
    const result = discoverAccountsInPool([directDebit, cardList]);
    expect(result.endpoint).not.toBe(false);
    if (result.endpoint !== false) {
      expect(result.endpoint.url).toContain('GetCardList');
    }
    expect(result.ids.length).toBe(8);
  });

  it('Isracard pattern: 3-card DirectDebit FIRST, 8-card CardList SECOND → picks 8-card', () => {
    const directDebit = makeCapture({
      url: 'https://web.isracard.example/ocp/.../GetDirectDebitList',
      method: 'GET',
      captureIndex: 187,
      responseBody: {
        data: {
          cards: [{ cardNumber: '5290' }, { cardNumber: '5167' }, { cardNumber: '1314' }],
        },
      },
    });
    const cardList = makeCapture({
      url: 'https://web.isracard.example/ocp/.../GetCardList',
      method: 'POST',
      captureIndex: 188,
      responseBody: {
        data: {
          cardsList: [
            { cardSuffix: '0786', accountNumber: '203489' },
            { cardSuffix: '1314', accountNumber: '228812' },
            { cardSuffix: '6440', accountNumber: '515331' },
            { cardSuffix: '5290', accountNumber: '228812' },
            { cardSuffix: '5167', accountNumber: '190691' },
            { cardSuffix: '0734', accountNumber: '66028' },
            { cardSuffix: '8912', accountNumber: '228812' },
            { cardSuffix: '9921', accountNumber: '248480' },
          ],
        },
      },
    });
    const result = discoverAccountsInPool([directDebit, cardList]);
    expect(result.endpoint).not.toBe(false);
    if (result.endpoint !== false) {
      expect(result.endpoint.url).toContain('GetCardList');
    }
    expect(result.ids.length).toBe(8);
  });

  it('single container endpoint → picker returns it', () => {
    const single = makeCapture({
      url: 'https://api.discount.example/userAccountsData',
      method: 'GET',
      responseBody: {
        UserAccountsData: {
          UserAccounts: [
            {
              NewAccountInfo: { BankID: '0011', AccountID: 'fake-acct-A' },
              FormatAccountID: '99-999-FAKE',
            },
          ],
        },
      },
    });
    const result = discoverAccountsInPool([single]);
    expect(result.endpoint).not.toBe(false);
    expect(result.ids.length).toBeGreaterThan(0);
  });

  it('tie on count → tie-break by metadata richness (richer wins)', () => {
    const sparse = makeCapture({
      url: 'https://api.bank.example/sparse',
      method: 'GET',
      captureIndex: 5,
      responseBody: {
        cardsList: [{ cardSuffix: '0001' }, { cardSuffix: '0002' }],
      },
    });
    const rich = makeCapture({
      url: 'https://api.bank.example/rich',
      method: 'GET',
      captureIndex: 6,
      responseBody: {
        cardsList: [
          { cardSuffix: '0001', cardName: 'Gold', OwnerFullName: 'Test', accountNumber: '1' },
          { cardSuffix: '0002', cardName: 'Plat', OwnerFullName: 'Test', accountNumber: '2' },
        ],
      },
    });
    const result = discoverAccountsInPool([sparse, rich]);
    expect(result.endpoint).not.toBe(false);
    if (result.endpoint !== false) {
      expect(result.endpoint.url).toContain('rich');
    }
  });

  it('tie on count and richness → earlier captureIndex wins (deterministic)', () => {
    const earlier = makeCapture({
      url: 'https://api.bank.example/first',
      method: 'GET',
      captureIndex: 1,
      responseBody: {
        cardsList: [
          { cardSuffix: '0001', accountNumber: '1' },
          { cardSuffix: '0002', accountNumber: '2' },
        ],
      },
    });
    const later = makeCapture({
      url: 'https://api.bank.example/second',
      method: 'GET',
      captureIndex: 2,
      responseBody: {
        cardsList: [
          { cardSuffix: '0001', accountNumber: '1' },
          { cardSuffix: '0002', accountNumber: '2' },
        ],
      },
    });
    const result = discoverAccountsInPool([later, earlier]);
    expect(result.endpoint).not.toBe(false);
    if (result.endpoint !== false) {
      expect(result.endpoint.url).toContain('first');
    }
  });

  it('empty pool → endpoint=false, ids empty', () => {
    const result = discoverAccountsInPool([]);
    expect(result.endpoint).toBe(false);
    expect(result.ids.length).toBe(0);
  });

  it('no named-container endpoint, no root-array, no request-side id → endpoint=false', () => {
    const noise = makeCapture({
      url: 'https://api.bank.example/marketing_banner',
      method: 'GET',
      responseBody: { promotion: { title: 'Some banner' } },
    });
    const result = discoverAccountsInPool([noise]);
    expect(result.endpoint).toBe(false);
    expect(result.ids.length).toBe(0);
  });

  it('no named container BUT root-array fallback hits (Hapoalim shape)', () => {
    const hapoalim = makeCapture({
      url: 'https://login.hapoalim.example/ServerServices/general/accounts',
      method: 'GET',
      responseBody: [
        { bankNumber: 12, branchNumber: 170, accountNumber: 536347, productLabel: '170 536347' },
      ],
    });
    const result = discoverAccountsInPool([hapoalim]);
    expect(result.endpoint).not.toBe(false);
    expect(result.ids).toContain('536347');
  });
});
