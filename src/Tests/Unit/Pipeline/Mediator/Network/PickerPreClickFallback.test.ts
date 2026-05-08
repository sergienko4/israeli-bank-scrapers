/**
 * Phase 7f — picker discipline + deepened shape gate.
 *
 * <p>Pins the deepened `hasTxnArray` so non-WK array shapes
 * (Discount's `OperationEntry[]` carrying `OperationDate` +
 * `OperationAmount`) are recognised. The post-click vs pre-click
 * priority of `discoverShapeAware` is exercised by the cross-bank
 * suite via real fixtures.
 */

import { createFrozenNetwork } from '../../../../../Scrapers/Pipeline/Mediator/Network/NetworkDiscovery.js';
import type { IDiscoveredEndpoint } from '../../../../../Scrapers/Pipeline/Mediator/Network/NetworkDiscoveryTypes.js';
import { hasTxnArray } from '../../../../../Scrapers/Pipeline/Mediator/Scrape/TxnShape.js';

const DISCOUNT_FOR_HOMEPAGE_BODY = {
  CurrentAccountLastTransactions: {
    OperationEntry: [
      { OperationDate: '20260417', OperationAmount: 110 },
      { OperationDate: '20260419', OperationAmount: 1200 },
    ],
  },
};

const BEINLEUMI_SPLIT_BODY = {
  transactions: [
    { dateOfRegistration: '2026-04-15', creditAmount: 250, debitAmount: 0 },
    { dateOfRegistration: '2026-04-16', creditAmount: 0, debitAmount: 50 },
  ],
};

const HAPOALIM_PROVIDED_BODY = {
  result: {
    transactions: [
      { eventDate: '2026-04-10', eventAmount: -120 },
      { eventDate: '2026-04-11', eventAmount: 250 },
    ],
  },
};

describe('TxnShape.hasTxnArray — Phase 7f deepened gate', () => {
  it('accepts Discount real-shape forHomePage body (OperationEntry[])', () => {
    const matched = hasTxnArray(DISCOUNT_FOR_HOMEPAGE_BODY);
    expect(matched).toBe(true);
  });

  it('accepts Beinleumi real-shape body (transactions[] with credit/debit split)', () => {
    const matched = hasTxnArray(BEINLEUMI_SPLIT_BODY);
    expect(matched).toBe(true);
  });

  it('accepts Hapoalim-class result.transactions[] body', () => {
    const matched = hasTxnArray(HAPOALIM_PROVIDED_BODY);
    expect(matched).toBe(true);
  });

  it('rejects a body whose nested array carries records with neither date nor amount aliases', () => {
    const matched = hasTxnArray({ result: { irrelevant: [{ id: 1 }] } });
    expect(matched).toBe(false);
  });

  it('rejects an empty body', () => {
    const matched = hasTxnArray({});
    expect(matched).toBe(false);
  });

  it('rejects a non-object body (defensive)', () => {
    const matchedNull = hasTxnArray(null);
    expect(matchedNull).toBe(false);
    const matchedString = hasTxnArray('not-json');
    expect(matchedString).toBe(false);
  });
});

/**
 * Build a synthetic captured endpoint for the picker-tier tests.
 *
 * @param url - Captured URL.
 * @param timestamp - Capture timestamp.
 * @param responseBody - Response body to drive the shape gate.
 * @returns Synthetic IDiscoveredEndpoint.
 */
function makeFrozenCapture(
  url: string,
  timestamp: number,
  responseBody: Readonly<Record<string, unknown>>,
): IDiscoveredEndpoint {
  return {
    url,
    method: 'GET',
    postData: '',
    contentType: 'application/json',
    requestHeaders: {},
    responseHeaders: {},
    responseBody,
    timestamp,
  };
}

describe('discoverTransactionsEndpoint — Phase 7f post-click first / pre-click fallback', () => {
  const clickAt = 1_000_000_000_000;
  const preClickTs = clickAt - 5_000;
  const postClickTs = clickAt + 5_000;

  it('picks the post-click match when the post-click pool has a WK-txn URL', () => {
    const preClick = makeFrozenCapture(
      'https://bank.fake.example/api/lastTransactions/preview',
      preClickTs,
      { result: { transactions: [{ purchaseDate: '2026-04-01', paymentSum: -10 }] } },
    );
    const postClick = makeFrozenCapture(
      'https://bank.fake.example/api/lastTransactions/full',
      postClickTs,
      { result: { transactions: [{ purchaseDate: '2026-04-02', paymentSum: -25 }] } },
    );
    const network = createFrozenNetwork([preClick, postClick], false, clickAt);
    const picked = network.discoverTransactionsEndpoint();
    expect(picked).not.toBe(false);
    if (picked !== false) {
      expect(picked.url).toBe(postClick.url);
      expect(picked.capturedPreClick).toBe(false);
    }
  });

  it('falls back to pre-click capture when the post-click pool is empty', () => {
    // Visacal-class: only pre-click capture in pool, click-at marker
    // splits it as pre. The fallback tier `preClickFallback` recovers.
    const preClick = makeFrozenCapture(
      'https://bank.fake.example/api/lastTransactions/full',
      preClickTs,
      { result: { transactions: [{ purchaseDate: '2026-04-01', paymentSum: -10 }] } },
    );
    const network = createFrozenNetwork([preClick], false, clickAt);
    const picked = network.discoverTransactionsEndpoint();
    expect(picked).not.toBe(false);
    if (picked !== false) {
      expect(picked.url).toBe(preClick.url);
      expect(picked.capturedPreClick).toBe(true);
      expect(picked.pickerTier).toBe('preClickFallback');
    }
  });

  it('returns false when neither pool has a WK-txn match', () => {
    const unrelated = makeFrozenCapture('https://bank.fake.example/api/balance', postClickTs, {
      balance: 1000,
    });
    const network = createFrozenNetwork([unrelated], false, clickAt);
    const picked = network.discoverTransactionsEndpoint();
    expect(picked).toBe(false);
  });
});
