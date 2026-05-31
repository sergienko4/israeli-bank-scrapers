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

// ── M4.F2 — picker rejects `/statuspage/` widget URLs ────────────
//
// Forcing function: post-M4.F1 Isracard real-bank run
// `10-05-2026_23355229` truncated each card's transactions to 5
// (vs 25 in run `23064644` that used the real API). The widget
// URL `/ocp/statuspage/DigitalV3.StatusPage/GetLatestTransactions`
// matches WK_API.transactions and `hasTxnArray`; the picker today
// commits it. SCRAPE replays per card; widget caps at 5 latest →
// silent truncation. This block pins the reject behaviour so a
// future widget URL can never reach SCRAPE.

const WIDGET_URL =
  'https://web.bank.fake.example/ocp/statuspage/DigitalV3.StatusPage/GetLatestTransactions';
const WIDGET_BODY = {
  data: [
    { last4digits: '9991', purchaseDate: '08/05/2026', ilsAmount: 90 },
    { last4digits: '9991', purchaseDate: '08/05/2026', ilsAmount: 11.9 },
    { last4digits: '9992', purchaseDate: '08/05/2026', ilsAmount: 126.7 },
    { last4digits: '9993', purchaseDate: '05/05/2026', ilsAmount: 80 },
    { last4digits: '9992', purchaseDate: '05/05/2026', ilsAmount: 270 },
  ],
  errorCode: '00',
  isSuccess: true,
};

const REAL_API_URL =
  'https://web.bank.fake.example/ocp/transactions/DigitalV3.Transactions/GetTransactionsList';
const REAL_API_BODY = {
  data: {
    israelAbroadVouchers: {
      vouchers: {
        israelAbroadVouchersList: [
          { purchaseDate: '08/05/2026', ilsAmount: 90, businessName: 'A' },
          { purchaseDate: '07/05/2026', ilsAmount: 50, businessName: 'B' },
        ],
      },
    },
  },
};

describe('M4.F2 — picker rejects `/statuspage/` widget URLs', () => {
  const clickAt = 1_000_000_000_000;
  const preClickTs = clickAt - 5_000;
  const postClickTs = clickAt + 5_000;

  it('REJECTS a widget-only post-click pool (StatusPage URL is the bug)', () => {
    const widget = makeFrozenCapture(WIDGET_URL, postClickTs, WIDGET_BODY);
    const network = createFrozenNetwork([widget], false, clickAt);
    const picked = network.discoverTransactionsEndpoint();
    expect(picked).toBe(false);
  });

  it('REJECTS a widget-only pre-click pool (no real API ever fired)', () => {
    const widget = makeFrozenCapture(WIDGET_URL, preClickTs, WIDGET_BODY);
    const network = createFrozenNetwork([widget], false, clickAt);
    const picked = network.discoverTransactionsEndpoint();
    expect(picked).toBe(false);
  });

  it('PREFERS the real API when both widget AND real API are captured', () => {
    const widget = makeFrozenCapture(WIDGET_URL, postClickTs, WIDGET_BODY);
    const realApi = makeFrozenCapture(REAL_API_URL, postClickTs, REAL_API_BODY);
    const network = createFrozenNetwork([widget, realApi], false, clickAt);
    const picked = network.discoverTransactionsEndpoint();
    expect(picked).not.toBe(false);
    if (picked !== false) {
      expect(picked.url).toBe(REAL_API_URL);
    }
  });
});

// ── M4.F2 — cross-bank regression guard: real APIs MUST stay accepted ────────
//
// Each row is the picked URL captured in production for that
// bank (cross-validated against `C:/tmp/runs/pipeline/<bank>/.../network/`).
// Adding the `/statuspage/` reject MUST NOT regress any real API.

interface IBankUrlFixture {
  readonly bank: string;
  readonly url: string;
  readonly body: Readonly<Record<string, unknown>>;
}

const REAL_API_FIXTURES: readonly IBankUrlFixture[] = [
  {
    bank: 'discount',
    url: 'https://start.telebank.fake.example/Titan/gatewayAPI/lastTransactions/transactions/9999999999/forHomePage?NumberOfTransactions=6',
    body: {
      CurrentAccountLastTransactions: {
        OperationEntry: [
          { OperationDate: '20260417', OperationAmount: 110 },
          { OperationDate: '20260419', OperationAmount: 1200 },
        ],
      },
    },
  },
  {
    bank: 'hapoalim',
    url: 'https://login.bankhapoalim.fake.example/ServerServices/current-account/transactions',
    body: {
      transactions: [
        { eventDate: '2026-04-10', eventAmount: -120 },
        { eventDate: '2026-04-11', eventAmount: 250 },
      ],
    },
  },
  {
    bank: 'max',
    url: 'https://www.max.fake.example/api/registered/transactionDetails/getTransactionsAndGraphs',
    body: {
      result: {
        transactions: [
          { purchaseDate: '2026-05-08T09:58:36', originalAmount: 13.84, shortCardNumber: '9994' },
        ],
      },
    },
  },
  {
    bank: 'visacal',
    url: 'https://api.cal-online.fake.example/Transactions/api/filteredTransactions/getFilteredTransactions',
    body: {
      result: {
        transactions: [{ purchaseDate: '2026-05-01', paymentSum: -25 }],
      },
    },
  },
  {
    bank: 'amex',
    url: 'https://web.americanexpress.fake.example/ocp/transactions/DigitalV3.Transactions/GetTransactionsList',
    body: REAL_API_BODY,
  },
  {
    bank: 'beinleumi',
    url: 'https://online.fibi.fake.example/appsng/bff-balancetransactions/api/v1/transactions/list',
    body: {
      transactions: [
        { dateOfRegistration: '2026-05-09T10:39:46', creditAmount: 0, debitAmount: 15000 },
      ],
    },
  },
];

describe.each(REAL_API_FIXTURES)(
  'M4.F2 cross-bank safelist — $bank real API must NOT be rejected',
  fixture => {
    it('tierPick accepts the real-API URL', () => {
      const clickAt = 1_000_000_000_000;
      const postClickTs = clickAt + 5_000;
      const capture = makeFrozenCapture(fixture.url, postClickTs, fixture.body);
      const network = createFrozenNetwork([capture], false, clickAt);
      const picked = network.discoverTransactionsEndpoint();
      expect(picked).not.toBe(false);
      if (picked !== false) {
        expect(picked.url).toBe(fixture.url);
      }
    });
  },
);

// ── Phase H'' — `windowParamsMatch` rescue tier ─────────────────
//
// Forcing function: Hapoalim dormant-account dashboards where the
// SPA never fires the txn POST during DASHBOARD-ACTION. The pool
// carries one populated-body GET whose URL exposes the canonical
// WK fromDate/toDate aliases (retrievalStartDate / retrievalEndDate).
// Body fails the txn-shape gate (summary stub, no transactions[]).
// Previously the picker fell through to `none` and DASHBOARD.FINAL
// failed loud. The new `windowParamsMatch` tier rescues such pools
// by committing the URL so SCRAPE can re-query with a wider window
// via `applyDateRangeToUrl`.

describe("Phase H'' — windowParamsMatch picker tier", () => {
  const clickAt = 1_000_000_000_000;
  const postClickTs = clickAt + 5_000;

  it('rescues populated-body GET when URL exposes WK fromDate + toDate aliases', () => {
    const dormant = makeFrozenCapture(
      'https://login.bankhapoalim.fake.example/ServerServices/current-account/transactions' +
        '?retrievalStartDate=20260415&retrievalEndDate=20260515&accountId=00-000-000000&lang=he',
      postClickTs,
      { summary: { balance: 150, lastTransactionDate: '20260315' } },
    );
    const network = createFrozenNetwork([dormant], false, clickAt);
    const picked = network.discoverTransactionsEndpoint();
    expect(picked).not.toBe(false);
    if (picked !== false) {
      expect(picked.url).toBe(dormant.url);
      expect(picked.pickerTier).toBe('windowParamsMatch');
    }
  });

  it('does NOT pick a URL exposing only one side of the WK alias pair', () => {
    const fromOnly = makeFrozenCapture(
      'https://login.bankhapoalim.fake.example/ServerServices/current-account/transactions' +
        '?retrievalStartDate=20260415&accountId=00-000-000000&lang=he',
      postClickTs,
      { summary: { balance: 150 } },
    );
    const network = createFrozenNetwork([fromOnly], false, clickAt);
    const picked = network.discoverTransactionsEndpoint();
    expect(picked).toBe(false);
  });
});
