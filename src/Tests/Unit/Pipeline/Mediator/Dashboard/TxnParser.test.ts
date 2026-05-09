/**
 * Phase 7f — TxnParser unit tests.
 *
 * <p>Pins the contract for `parseFreshResponse(body, fieldMap)` and
 * `buildPerAccountBody(template, accountId, range)`. The functions
 * are SCRAPE's only entry into per-account txn extraction; the
 * architecture rule R-TXN-PARSE forbids any other SCRAPE-zone direct
 * call to `extractTransactions(body)`.
 *
 * <p>Phase 7f follow-up: also pins the harvest builder and its
 * scope-extraction helpers (`extractAccountIdFromUrl`,
 * `detectMultiAccountScope`, `buildTxnHarvest`). The harvest is the
 * mirror of `IAccountDiscovery.records` — a clean value-type pass of
 * the records DASHBOARD already saw, so SCRAPE can attribute them to
 * the iteration's accountId without re-fetching.
 */

import {
  buildPerAccountBody,
  buildTxnHarvest,
  detectMultiAccountScope,
  extractAccountIdFromUrl,
  parseFreshResponse,
} from '../../../../../Scrapers/Pipeline/Mediator/Dashboard/TxnParser.js';
import { EMPTY_TXN_ENDPOINT } from '../../../../../Scrapers/Pipeline/Strategy/Scrape/ScrapeTypes.js';
import type {
  ITxnEndpointInternal,
  ITxnFieldMap,
} from '../../../../../Scrapers/Pipeline/Types/PipelineContext.js';
import { EMPTY_TXN_HARVEST } from '../../../../../Scrapers/Pipeline/Types/PipelineContext.js';
import type { ITransaction } from '../../../../../Transactions.js';

const FIELD_MAP: ITxnFieldMap = EMPTY_TXN_ENDPOINT.fieldMap;

const FAKE_BODY: Readonly<Record<string, unknown>> = {
  result: {
    transactions: [
      {
        purchaseDate: '2026-04-05',
        paymentSum: -65,
        merchantName: 'FAKE-CAFE',
        currencySymbol: 'ILS',
      },
      {
        purchaseDate: '2026-04-06',
        paymentSum: -45.5,
        merchantName: 'FAKE-SHOP',
        currencySymbol: 'ILS',
      },
    ],
  },
};

describe('parseFreshResponse', () => {
  it('extracts transactions from a real-shape body via auto-discovery', () => {
    const result = parseFreshResponse(FAKE_BODY, FIELD_MAP);
    expect(result.length).toBeGreaterThanOrEqual(2);
  });

  it('returns an empty array when the body has no transaction shape', () => {
    const result = parseFreshResponse({ unrelated: 'shape' }, FIELD_MAP);
    expect(result).toEqual([]);
  });

  it('returns empty for a body that is JSON object with no records', () => {
    const result = parseFreshResponse({ result: { transactions: [] } }, FIELD_MAP);
    expect(result).toEqual([]);
  });
});

describe('buildPerAccountBody', () => {
  const fakeRange = {
    startDate: new Date('2026-01-01'),
    endDate: new Date('2026-04-30'),
  };

  it('returns the template unchanged today (Phase 7g migration is the substitution)', () => {
    const out = buildPerAccountBody('{"cardUniqueId":"FAKE-1"}', 'FAKE-1', fakeRange);
    expect(out).toBe('{"cardUniqueId":"FAKE-1"}');
  });

  it('returns the empty template unchanged for GET-only banks', () => {
    const out = buildPerAccountBody('', 'FAKE-1', fakeRange);
    expect(out).toBe('');
  });

  it('does not mutate the supplied template across calls', () => {
    const template = '{"cardUniqueId":"FAKE-2"}';
    const first = buildPerAccountBody(template, 'FAKE-2', fakeRange);
    const second = buildPerAccountBody(template, 'FAKE-3', fakeRange);
    expect(first).toBe(template);
    expect(second).toBe(template);
  });
});

describe('extractAccountIdFromUrl', () => {
  it('returns the WK_ACCT.id-aliased value when the URL has an accountId param', () => {
    const url =
      'https://bank.fake.example/ServerServices/transactions?numItemsPerPage=150&accountId=12-170-FAKE&lang=he';
    const captured = extractAccountIdFromUrl(url);
    expect(captured).toBe('12-170-FAKE');
  });

  it('returns the WK_ACCT.id-aliased value when the URL uses cardUniqueId', () => {
    const url = 'https://bank.fake.example/api/txns?cardUniqueId=FAKE-CARD-99&fromDate=2026-01-01';
    const captured = extractAccountIdFromUrl(url);
    expect(captured).toBe('FAKE-CARD-99');
  });

  it('returns false when the URL has no recognised accountId-alias param', () => {
    const url = 'https://bank.fake.example/api/txns?fromDate=2026-01-01&toDate=2026-04-30';
    const captured = extractAccountIdFromUrl(url);
    expect(captured).toBe(false);
  });

  it('returns false when the URL has no query string at all', () => {
    const captured = extractAccountIdFromUrl('https://bank.fake.example/api/txns');
    expect(captured).toBe(false);
  });

  it('returns false when the alias is present but value is empty', () => {
    const url = 'https://bank.fake.example/api/txns?accountId=&otherParam=x';
    const captured = extractAccountIdFromUrl(url);
    expect(captured).toBe(false);
  });

  it('falls back to raw value when decodeURIComponent throws on malformed encoding', () => {
    const url = 'https://bank.fake.example/api/txns?accountId=FAKE%E0%A4&other=x';
    const captured = extractAccountIdFromUrl(url);
    expect(captured).toBe('FAKE%E0%A4');
  });

  it('skips pairs without "=" or with "=" at position 0', () => {
    const url = 'https://bank.fake.example/api/txns?orphan&=oops&accountId=FAKE-1';
    const captured = extractAccountIdFromUrl(url);
    expect(captured).toBe('FAKE-1');
  });
});

describe('detectMultiAccountScope', () => {
  it('detects a body bundling many cards (cards: [...] length>1)', () => {
    const body = {
      result: {
        cards: [{ cardSuffix: 'FAKE-1' }, { cardSuffix: 'FAKE-2' }],
      },
    };
    const isMatched = detectMultiAccountScope(body);
    expect(isMatched).toBe(true);
  });

  it('detects a body bundling many bankAccounts', () => {
    const body = {
      bankAccounts: [{ accountNumber: 'FAKE-A' }, { accountNumber: 'FAKE-B' }],
    };
    const isMatched = detectMultiAccountScope(body);
    expect(isMatched).toBe(true);
  });

  it('returns false for a single-account body (cards length=1)', () => {
    const body = { cards: [{ cardSuffix: 'FAKE-1' }] };
    const isMatched = detectMultiAccountScope(body);
    expect(isMatched).toBe(false);
  });

  it('returns false for a body with no plural-scope keys', () => {
    const body = { transactions: [{ purchaseDate: '2026-04-01', paymentSum: -10 }] };
    const isMatched = detectMultiAccountScope(body);
    expect(isMatched).toBe(false);
  });

  it('returns false for an empty body', () => {
    const isMatched = detectMultiAccountScope({});
    expect(isMatched).toBe(false);
  });

  it('honours the BFS depth cap (no false positive at depth 5+)', () => {
    const deepBody = {
      l1: { l2: { l3: { l4: { l5: { cards: [{ a: 1 }, { b: 2 }] } } } } },
    };
    // BFS visits root + l1..l4 (depth 0..4); l5's cards array is past
    // the cap, so the deeper match must NOT count as multi-scope.
    const isMatched = detectMultiAccountScope(deepBody);
    expect(isMatched).toBe(false);
  });

  it('skips array values in queue traversal (only objects descend)', () => {
    // A nested array under a non-plural key must not crash the BFS,
    // and the function must keep returning the right scope.
    const body = { unrelated: [{ x: 1 }, { y: 2 }], cards: [{ id: 'FAKE-1' }] };
    const isMatched = detectMultiAccountScope(body);
    expect(isMatched).toBe(false);
  });

  it('detects multi-scope through one level of nesting', () => {
    const body = { result: { cards: [{ a: 1 }, { b: 2 }] } };
    const isMatched = detectMultiAccountScope(body);
    expect(isMatched).toBe(true);
  });
});

describe('buildTxnHarvest', () => {
  const fakeTxn: ITransaction = {
    type: 'normal',
    date: '2026-04-05',
    processedDate: '2026-04-05',
    originalAmount: -65,
    chargedAmount: -65,
    chargedCurrency: 'ILS',
    description: 'FAKE-CAFE',
    memo: '',
    status: 'completed',
    identifier: 'FAKE-1',
    originalCurrency: 'ILS',
  } as unknown as ITransaction;

  /**
   * Build an ITxnEndpointInternal with FAKE values + per-test overrides.
   * @param overrides - Partial fields to override the defaults.
   * @returns Synthetic ITxnEndpointInternal for buildTxnHarvest tests.
   */
  function makeInternal(overrides: Partial<ITxnEndpointInternal> = {}): ITxnEndpointInternal {
    const base: ITxnEndpointInternal = {
      endpoint: {
        ...EMPTY_TXN_ENDPOINT,
        url: 'https://bank.fake.example/api/txns?accountId=FAKE-ACCT-1',
        method: 'POST',
      },
      captureIndex: 1,
      responseBodySample: { transactions: [{ purchaseDate: '2026-04-05', paymentSum: -65 }] },
      normalizedRecords: [fakeTxn],
      pickerTier: 'postWithShape',
      capturedPreClick: false,
    };
    return { ...base, ...overrides };
  }

  it('extracts capturedAccountId from the URL when WK_ACCT.id alias present', () => {
    const internal = makeInternal();
    const harvest = buildTxnHarvest(internal, 1);
    expect(harvest.capturedAccountId).toBe('FAKE-ACCT-1');
    expect(harvest.records.length).toBe(1);
    expect(harvest.multiAccountScope).toBe(false);
  });

  it('marks multiAccountScope=true when the body bundles many cards', () => {
    const internal = makeInternal({
      responseBodySample: {
        result: {
          cards: [{ cardSuffix: 'FAKE-1' }, { cardSuffix: 'FAKE-2' }],
        },
      },
    });
    const harvest = buildTxnHarvest(internal, 1);
    expect(harvest.multiAccountScope).toBe(true);
  });

  it('returns capturedAccountId=false when URL has no accountId-alias param', () => {
    const internal = makeInternal({
      endpoint: { ...EMPTY_TXN_ENDPOINT, url: 'https://bank.fake.example/api/txns' },
    });
    const harvest = buildTxnHarvest(internal, 1);
    expect(harvest.capturedAccountId).toBe(false);
  });

  it('passes through normalizedRecords verbatim (no mutation)', () => {
    const internal = makeInternal();
    const harvest = buildTxnHarvest(internal, 1);
    expect(harvest.records).toBe(internal.normalizedRecords);
  });

  it('forces multiAccountScope=true when capture is unscoped AND > 1 accounts present (Amex / Isracard regression guard)', () => {
    const internal = makeInternal({
      endpoint: { ...EMPTY_TXN_ENDPOINT, url: 'https://bank.fake.example/api/txns' },
    });
    const harvest = buildTxnHarvest(internal, 8);
    expect(harvest.capturedAccountId).toBe(false);
    expect(harvest.multiAccountScope).toBe(true);
  });

  it('keeps multiAccountScope=false when capture is scoped to a single accountId even in a multi-account run', () => {
    const internal = makeInternal();
    const harvest = buildTxnHarvest(internal, 8);
    expect(harvest.capturedAccountId).toBe('FAKE-ACCT-1');
    expect(harvest.multiAccountScope).toBe(false);
  });
});

describe('EMPTY_TXN_HARVEST', () => {
  it('exposes an empty records array, no captured accountId, single-account scope', () => {
    expect(EMPTY_TXN_HARVEST.records).toEqual([]);
    expect(EMPTY_TXN_HARVEST.capturedAccountId).toBe(false);
    expect(EMPTY_TXN_HARVEST.multiAccountScope).toBe(false);
  });
});
