/**
 * Unified coverage for the ACCOUNT-RESOLVE pool helpers
 * (`discoverAccountsInPool` + `poolMaxContainer`).
 *
 * <p>One factory drives ONE test contract across every browser-flow
 * bank instead of N near-duplicate per-bank files. A bank fixture
 * declares its real response shape (URL pattern, body container,
 * field names) plus the expected picker outcome; the `describe.each`
 * block applies the same five assertions to every fixture. If any
 * helper drifts from any bank's shape, that bank's row turns red —
 * one source of truth, no per-file maintenance.
 *
 * <p>Sections:
 * <ul>
 *   <li><b>Cross-bank contract</b> — {@link BANK_FIXTURES} ×
 *       five behaviours each (endpoint pick, id count, sample id,
 *       order-agnostic pick, max-container score).</li>
 *   <li><b>Framework contracts</b> — bank-agnostic guards: empty
 *       pool, null body, scalar body, malformed JSON, etc.</li>
 *   <li><b>Tier ordering</b> — bank-agnostic priorities the picker
 *       enforces between named container, root array, and
 *       request-side extraction.</li>
 *   <li><b>Picker tie-break edges</b> — three micro-coverage cases
 *       previously isolated under `AccountFromPoolEdgeCases`:
 *       `isPopulated` null/undefined, `compareCandidates`
 *       captureIndex fallback, `asAccountId` numeric coercion.</li>
 * </ul>
 *
 * <p>All identifiers, account numbers, names, and suffixes are
 * fabricated test data. URL hosts use `.example` TLDs to make that
 * explicit. Bank shape — URL paths, container keys, record fields
 * — mirrors what each bank's auth flow surfaces in production.
 */

import {
  discoverAccountsInPool,
  poolMaxContainer,
} from '../../../../../Scrapers/Pipeline/Mediator/AccountResolve/AccountFromPool.js';
import type { IDiscoveredEndpoint } from '../../../../../Scrapers/Pipeline/Mediator/Network/NetworkDiscoveryTypes.js';

/** Args for {@link makeCapture}. */
interface IMakeCaptureArgs {
  readonly url: string;
  readonly method: 'GET' | 'POST';
  readonly responseBody: unknown;
  readonly postData?: string;
  readonly captureIndex?: number;
}

/**
 * Build a synthetic {@link IDiscoveredEndpoint} with sensible test
 * defaults. Every required field is populated so the picker can
 * reach the body inspectors without short-circuiting on missing
 * metadata.
 *
 * @param args - Capture metadata + body.
 * @returns Endpoint stub.
 */
function makeCapture(args: IMakeCaptureArgs): IDiscoveredEndpoint {
  return {
    url: args.url,
    method: args.method,
    postData: args.postData ?? '',
    responseBody: args.responseBody,
    contentType: 'application/json',
    requestHeaders: {},
    responseHeaders: {},
    timestamp: 100,
    captureIndex: args.captureIndex ?? 0,
  };
}

// ─── Bank fixtures (FAKE data, REAL bank shape) ──────────────────

/** Test driver row for one browser-flow bank. */
interface IBankFixture {
  /** Display name for `describe.each` and assertion messages. */
  readonly bank: string;
  /** Pool the picker is fed. */
  readonly pool: readonly IDiscoveredEndpoint[];
  /** Substring the picked endpoint's URL must contain. */
  readonly expectedUrlContains: string;
  /** Resolved id count the picker must surface. */
  readonly expectedIdCount: number;
  /** One id that MUST appear in `result.ids`. */
  readonly sampleId: string;
  /** Largest WK named-container size visible across `pool`. */
  readonly expectedMaxContainer: number;
}

// Amex: pool pre-loads a 1-card `GetDirectDebitList` so the picker
// must score by max-cardinality and pick the 3-card `GetCardList`.
const AMEX_FIXTURE: IBankFixture = {
  bank: 'amex',
  pool: [
    makeCapture({
      url: 'https://web.americanexpress.example/ocp/.../GetDirectDebitList',
      method: 'GET',
      captureIndex: 162,
      responseBody: { data: { cards: [{ cardNumber: 'FAKE-AMEX-DD-0001' }] } },
    }),
    makeCapture({
      url: 'https://web.americanexpress.example/ocp/.../GetCardList',
      method: 'POST',
      captureIndex: 163,
      responseBody: {
        data: {
          cardsList: [
            { cardSuffix: 'FAKE-AMEX-CL-A', accountNumber: 'FAKE-ACCT-A', cardName: 'Gold' },
            { cardSuffix: 'FAKE-AMEX-CL-B', accountNumber: 'FAKE-ACCT-B', cardName: 'Plat' },
            { cardSuffix: 'FAKE-AMEX-CL-C', accountNumber: 'FAKE-ACCT-C', cardName: 'Corp' },
          ],
        },
      },
    }),
  ],
  expectedUrlContains: 'GetCardList',
  expectedIdCount: 3,
  sampleId: 'FAKE-AMEX-CL-A',
  expectedMaxContainer: 3,
};

// Isracard mirrors Amex's `cardsList[]` shape; pre-loads a smaller
// directDebitList capture to assert max-cardinality scoring.
const ISRACARD_FIXTURE: IBankFixture = {
  bank: 'isracard',
  pool: [
    makeCapture({
      url: 'https://web.isracard.example/ocp/.../GetDirectDebitList',
      method: 'GET',
      captureIndex: 187,
      responseBody: {
        data: {
          cards: [{ cardNumber: 'FAKE-ICAL-DD-0001' }, { cardNumber: 'FAKE-ICAL-DD-0002' }],
        },
      },
    }),
    makeCapture({
      url: 'https://web.isracard.example/ocp/.../GetCardList',
      method: 'POST',
      captureIndex: 188,
      responseBody: {
        data: {
          cardsList: [
            { cardSuffix: 'FAKE-ICAL-CL-A', accountNumber: 'FAKE-ICAL-ACCT-A' },
            { cardSuffix: 'FAKE-ICAL-CL-B', accountNumber: 'FAKE-ICAL-ACCT-B' },
            { cardSuffix: 'FAKE-ICAL-CL-C', accountNumber: 'FAKE-ICAL-ACCT-C' },
          ],
        },
      },
    }),
  ],
  expectedUrlContains: 'GetCardList',
  expectedIdCount: 3,
  sampleId: 'FAKE-ICAL-CL-A',
  expectedMaxContainer: 3,
};

// Discount: nested `UserAccountsData.UserAccounts[]` exposes both
// `NewAccountInfo.AccountID` and `FormatAccountID`.
const DISCOUNT_FIXTURE: IBankFixture = {
  bank: 'discount',
  pool: [
    makeCapture({
      url: 'https://api.discount.example/userAccountsData',
      method: 'GET',
      captureIndex: 50,
      responseBody: {
        UserAccountsData: {
          UserAccounts: [
            {
              NewAccountInfo: { BankID: '0011', AccountID: 'FAKE-DISCOUNT-A' },
              FormatAccountID: '99-999-FAKE-A',
            },
            {
              NewAccountInfo: { BankID: '0011', AccountID: 'FAKE-DISCOUNT-B' },
              FormatAccountID: '99-999-FAKE-B',
            },
          ],
        },
      },
    }),
  ],
  expectedUrlContains: 'userAccountsData',
  expectedIdCount: 2,
  sampleId: 'FAKE-DISCOUNT-A',
  expectedMaxContainer: 2,
};

// Hapoalim: root JSON array — picker takes the `looksLikeAccount`
// fallback (no named container).
const HAPOALIM_FIXTURE: IBankFixture = {
  bank: 'hapoalim',
  pool: [
    makeCapture({
      url: 'https://login.hapoalim.example/ServerServices/general/accounts',
      method: 'GET',
      captureIndex: 75,
      responseBody: [
        {
          bankNumber: 12,
          branchNumber: 170,
          accountNumber: [REDACTED-ACCT-6],
          productLabel: '170 FAKE-HAPO-A',
        },
        {
          bankNumber: 12,
          branchNumber: 170,
          accountNumber: 536348,
          productLabel: '170 FAKE-HAPO-B',
        },
      ],
    }),
  ],
  expectedUrlContains: 'general/accounts',
  expectedIdCount: 2,
  sampleId: '[REDACTED-ACCT-6]',
  expectedMaxContainer: 0,
};

// Max: `result.cards[]` from `getRegisterUserData` (POST).
const MAX_FIXTURE: IBankFixture = {
  bank: 'max',
  pool: [
    makeCapture({
      url: 'https://api.max.example/api/registration/getRegisterUserData',
      method: 'POST',
      captureIndex: 12,
      responseBody: {
        result: {
          user: { firstName: 'TEST', lastName: 'USER' },
          cards: [
            { cardNumber: 'FAKE-MAX-A', cardName: 'FAKE-MAX-CARD-A', ownerName: 'TEST USER' },
            { cardNumber: 'FAKE-MAX-B', cardName: 'FAKE-MAX-CARD-B', ownerName: 'TEST USER' },
          ],
        },
      },
    }),
  ],
  expectedUrlContains: 'getRegisterUserData',
  expectedIdCount: 2,
  sampleId: 'FAKE-MAX-A',
  expectedMaxContainer: 2,
};

// Visacal: both `bankAccounts[]` and `cards[]` under `result`;
// picker sums all WK named containers (`poolMaxContainer` total).
const VISACAL_FIXTURE: IBankFixture = {
  bank: 'visacal',
  pool: [
    makeCapture({
      url: 'https://api.cal-online.example/Authentication/api/account/init',
      method: 'POST',
      captureIndex: 25,
      responseBody: {
        result: {
          user: { firstName: 'TEST', lastName: 'USER' },
          cards: [
            { cardUniqueId: 'FAKE-VC-CARD-A', last4Digits: '1111' },
            { cardUniqueId: 'FAKE-VC-CARD-B', last4Digits: '2222' },
            { cardUniqueId: 'FAKE-VC-CARD-C', last4Digits: '3333' },
          ],
          bankAccounts: [
            { bankAccountUniqueId: 'FAKE-VC-BANK-A', bankAccountNum: '0001111' },
            { bankAccountUniqueId: 'FAKE-VC-BANK-B', bankAccountNum: '0002222' },
          ],
        },
      },
    }),
  ],
  expectedUrlContains: 'account/init',
  expectedIdCount: 5,
  sampleId: 'FAKE-VC-CARD-A',
  expectedMaxContainer: 5,
};

// Beinleumi: single `data.accounts[]` container from `/api/accounts`.
const BEINLEUMI_FIXTURE: IBankFixture = {
  bank: 'beinleumi',
  pool: [
    makeCapture({
      url: 'https://www.fibi.example/api/accounts',
      method: 'GET',
      captureIndex: 6,
      responseBody: {
        data: {
          accounts: [
            {
              accountId: 'FAKE-BEINLEUMI-001',
              accountNumber: '0009999',
              branchNumber: '012',
              displayName: 'FAKE DEFAULT',
            },
          ],
        },
      },
    }),
  ],
  expectedUrlContains: '/api/accounts',
  expectedIdCount: 1,
  sampleId: 'FAKE-BEINLEUMI-001',
  expectedMaxContainer: 1,
};

const BANK_FIXTURES: readonly IBankFixture[] = [
  AMEX_FIXTURE,
  ISRACARD_FIXTURE,
  DISCOUNT_FIXTURE,
  HAPOALIM_FIXTURE,
  MAX_FIXTURE,
  VISACAL_FIXTURE,
  BEINLEUMI_FIXTURE,
];

// ─── Cross-bank contract (one factory, all banks) ────────────────

describe.each(BANK_FIXTURES)('$bank', fixture => {
  it('discoverAccountsInPool: returns the canonical id-bearing endpoint', () => {
    const result = discoverAccountsInPool(fixture.pool);
    expect(result.endpoint).not.toBe(false);
    if (result.endpoint !== false) {
      expect(result.endpoint.url).toContain(fixture.expectedUrlContains);
    }
  });

  it('discoverAccountsInPool: surfaces the expected id count', () => {
    const result = discoverAccountsInPool(fixture.pool);
    expect(result.ids.length).toBe(fixture.expectedIdCount);
  });

  it('discoverAccountsInPool: includes the sample id', () => {
    const result = discoverAccountsInPool(fixture.pool);
    expect(result.ids).toContain(fixture.sampleId);
  });

  it('discoverAccountsInPool: pick is order-agnostic — pool reversal preserves the URL', () => {
    const reversed = [...fixture.pool].reverse();
    const fwd = discoverAccountsInPool(fixture.pool);
    const rev = discoverAccountsInPool(reversed);
    expect(fwd.endpoint).not.toBe(false);
    expect(rev.endpoint).not.toBe(false);
    if (fwd.endpoint !== false && rev.endpoint !== false) {
      expect(rev.endpoint.url).toBe(fwd.endpoint.url);
    }
  });

  it('poolMaxContainer: returns the largest WK named-container size', () => {
    const max = poolMaxContainer(fixture.pool);
    expect(max).toBe(fixture.expectedMaxContainer);
  });
});

// ─── Framework contracts (bank-agnostic) ─────────────────────────

describe('framework contracts — empty / non-object bodies', () => {
  it('returns empty result for empty pool', () => {
    const result = discoverAccountsInPool([]);
    expect(result.endpoint).toBe(false);
    expect(result.ids.length).toBe(0);
    expect(result.records.length).toBe(0);
  });

  it('returns empty when no body has account shape', () => {
    const pool = [
      makeCapture({ url: 'https://api.bank.example/x', method: 'GET', responseBody: { foo: 1 } }),
      makeCapture({
        url: 'https://api.bank.example/y',
        method: 'GET',
        responseBody: { transactions: [{ id: 1 }] },
      }),
    ];
    const result = discoverAccountsInPool(pool);
    expect(result.endpoint).toBe(false);
  });

  it('skips captures with null body', () => {
    const pool = [
      makeCapture({ url: 'https://api.bank.example/null', method: 'GET', responseBody: null }),
      makeCapture({
        url: 'https://api.bank.example/ok',
        method: 'GET',
        responseBody: { accounts: [{ accountId: 'FAKE-A1' }] },
      }),
    ];
    const result = discoverAccountsInPool(pool);
    expect(result.endpoint).not.toBe(false);
  });

  it('skips captures with scalar (non-object, non-array) body', () => {
    const pool = [
      makeCapture({
        url: 'https://api.bank.example/string',
        method: 'GET',
        responseBody: 'a string body',
      }),
      makeCapture({ url: 'https://api.bank.example/num', method: 'GET', responseBody: 42 }),
      makeCapture({
        url: 'https://api.bank.example/ok',
        method: 'GET',
        responseBody: { cards: [{ cardUniqueId: 'FAKE-C1' }] },
      }),
    ];
    const result = discoverAccountsInPool(pool);
    expect(result.endpoint).not.toBe(false);
  });

  // Root-array bodies that must be rejected as not-account-shaped.
  const rootArrayRejects: readonly (readonly [string, unknown])[] = [
    ['root array of plain objects (no account-shape fields)', [{ foo: 'bar' }]],
    ['root array whose first element is null', [null]],
    ['empty root array', []],
  ];

  it.each(rootArrayRejects)('does NOT match: %s', (_label, body) => {
    const pool = [
      makeCapture({ url: 'https://api.bank.example/x', method: 'GET', responseBody: body }),
    ];
    const result = discoverAccountsInPool(pool);
    expect(result.endpoint).toBe(false);
  });
});

// ─── Tier ordering (bank-agnostic) ───────────────────────────────

describe('tier ordering', () => {
  it('prefers named-container hit over root-array hit', () => {
    const named = makeCapture({
      url: 'https://api.bank.example/named',
      method: 'GET',
      responseBody: { cards: [{ cardUniqueId: 'FAKE-NAMED-1' }] },
    });
    const rootArr = makeCapture({
      url: 'https://api.bank.example/root',
      method: 'GET',
      responseBody: [{ accountNumber: 'FAKE-ROOT-1' }],
    });
    const result = discoverAccountsInPool([rootArr, named]);
    expect(result.endpoint).toBe(named);
  });

  it('prefers body match over request-side extraction', () => {
    const both = makeCapture({
      url: 'https://api.bank.example/x?accountId=FAKE-URL-ID',
      method: 'GET',
      responseBody: { cards: [{ cardUniqueId: 'FAKE-BODY-ID' }] },
    });
    const result = discoverAccountsInPool([both]);
    expect(result.ids).toContain('FAKE-BODY-ID');
    expect(result.ids).not.toContain('FAKE-URL-ID');
  });

  it('tie on count → tie-break by metadata richness (richer wins)', () => {
    const sparse = makeCapture({
      url: 'https://api.bank.example/sparse',
      method: 'GET',
      captureIndex: 5,
      responseBody: { cardsList: [{ cardSuffix: 'FAKE-S-1' }, { cardSuffix: 'FAKE-S-2' }] },
    });
    const rich = makeCapture({
      url: 'https://api.bank.example/rich',
      method: 'GET',
      captureIndex: 6,
      responseBody: {
        cardsList: [
          { cardSuffix: 'FAKE-R-1', cardName: 'Gold', OwnerFullName: 'Test', accountNumber: '1' },
          { cardSuffix: 'FAKE-R-2', cardName: 'Plat', OwnerFullName: 'Test', accountNumber: '2' },
        ],
      },
    });
    const result = discoverAccountsInPool([sparse, rich]);
    expect(result.endpoint).not.toBe(false);
    if (result.endpoint !== false) expect(result.endpoint.url).toContain('rich');
  });

  it('tie on count + richness → earlier captureIndex wins (deterministic)', () => {
    const earlier = makeCapture({
      url: 'https://api.bank.example/first',
      method: 'GET',
      captureIndex: 1,
      responseBody: {
        cardsList: [
          { cardSuffix: 'FAKE-1', accountNumber: '1' },
          { cardSuffix: 'FAKE-2', accountNumber: '2' },
        ],
      },
    });
    const later = makeCapture({
      url: 'https://api.bank.example/second',
      method: 'GET',
      captureIndex: 2,
      responseBody: {
        cardsList: [
          { cardSuffix: 'FAKE-1', accountNumber: '1' },
          { cardSuffix: 'FAKE-2', accountNumber: '2' },
        ],
      },
    });
    const result = discoverAccountsInPool([later, earlier]);
    expect(result.endpoint).not.toBe(false);
    if (result.endpoint !== false) expect(result.endpoint.url).toContain('first');
  });
});

// ─── Request-side extraction (method-specific) ───────────────────

describe('request-side extraction', () => {
  it('extracts accountId from a GET URL query', () => {
    const cap = makeCapture({
      url: 'https://api.bank.example/data?accountId=FAKE-12-345-678&extra=x',
      method: 'GET',
      responseBody: { metadata: 1 },
    });
    const result = discoverAccountsInPool([cap]);
    expect(result.ids).toContain('FAKE-12-345-678');
  });

  it('extracts a numeric request-side id and coerces to string', () => {
    const cap = makeCapture({
      url: 'https://api.bank.example/data?accountId=987654',
      method: 'GET',
      responseBody: { unrelated: 1 },
    });
    const result = discoverAccountsInPool([cap]);
    expect(result.ids).toContain('987654');
  });

  it('extracts accountId from POST postData when no body container', () => {
    const cap = makeCapture({
      url: 'https://api.bank.example/transactions',
      method: 'POST',
      postData: '{"cardUniqueId":"FAKE-CARD","extra":"meta"}',
      responseBody: { transactions: [] },
    });
    const result = discoverAccountsInPool([cap]);
    expect(result.ids).toContain('FAKE-CARD');
  });

  // Each row is (label, capture) where capture must yield endpoint=false.
  const noMatchRows: readonly (readonly [string, IDiscoveredEndpoint])[] = [
    [
      'GET URL malformed (URL constructor throws)',
      makeCapture({
        url: 'not a url at all',
        method: 'GET',
        responseBody: { unrelated: 1 },
      }),
    ],
    [
      'POST postData empty string',
      makeCapture({
        url: 'https://api.bank.example/x',
        method: 'POST',
        postData: '',
        responseBody: { unrelated: 1 },
      }),
    ],
    [
      'POST postData invalid JSON',
      makeCapture({
        url: 'https://api.bank.example/x',
        method: 'POST',
        postData: 'not-json{{{',
        responseBody: { unrelated: 1 },
      }),
    ],
    [
      'POST postData JSON number scalar',
      makeCapture({
        url: 'https://api.bank.example/x',
        method: 'POST',
        postData: '42',
        responseBody: { unrelated: 1 },
      }),
    ],
    [
      'POST postData JSON array',
      makeCapture({
        url: 'https://api.bank.example/x',
        method: 'POST',
        postData: '[{"cardUniqueId":"X"}]',
        responseBody: { unrelated: 1 },
      }),
    ],
    [
      'POST postData JSON null',
      makeCapture({
        url: 'https://api.bank.example/x',
        method: 'POST',
        postData: 'null',
        responseBody: { unrelated: 1 },
      }),
    ],
    [
      'GET URL accountId="" (empty string)',
      makeCapture({
        url: 'https://api.bank.example/data?accountId=',
        method: 'GET',
        responseBody: { unrelated: 1 },
      }),
    ],
    [
      'PUT capture (method neither GET nor POST)',
      {
        url: 'https://api.bank.example/x?accountId=FAKE',
        method: 'PUT',
        postData: '',
        responseBody: { unrelated: 1 },
        contentType: 'application/json',
        requestHeaders: {},
        responseHeaders: {},
        timestamp: 0,
      } as unknown as IDiscoveredEndpoint,
    ],
  ];

  it.each(noMatchRows)('returns endpoint=false: %s', (_label, cap) => {
    const result = discoverAccountsInPool([cap]);
    expect(result.endpoint).toBe(false);
  });
});

// ─── Picker tie-break edges (Phase 7d micro-coverage) ────────────

describe('picker tie-break edges', () => {
  it('isPopulated treats null + undefined as empty (richness skips them)', () => {
    const body = {
      cards: [
        {
          cardSuffix: 'FAKE-1234',
          ownerName: null,
          extraField: undefined,
          enabled: true,
          balance: 0,
        },
      ],
    };
    const capture = makeCapture({
      url: 'https://api.bank.example/x',
      method: 'POST',
      responseBody: body,
    });
    const result = discoverAccountsInPool([capture]);
    expect(result.ids.length).toBe(1);
    expect(result.containers.cards.length).toBe(1);
  });

  it('compareCandidates falls back to 0 when both captures lack captureIndex', () => {
    // captureIndex omitted on both — `?? 0` fallback fires twice
    // (a then b) inside the comparator.
    const captureA: IDiscoveredEndpoint = {
      url: 'https://api.bank.example/a',
      method: 'POST',
      postData: '{}',
      responseBody: { cards: [{ cardSuffix: 'FAKE-A' }] },
      contentType: 'application/json',
      requestHeaders: {},
      responseHeaders: {},
      timestamp: 0,
    };
    const captureB: IDiscoveredEndpoint = {
      url: 'https://api.bank.example/b',
      method: 'POST',
      postData: '{}',
      responseBody: { cards: [{ cardSuffix: 'FAKE-B' }] },
      contentType: 'application/json',
      requestHeaders: {},
      responseHeaders: {},
      timestamp: 0,
    };
    const result = discoverAccountsInPool([captureA, captureB]);
    expect(result.ids.length).toBe(1);
  });

  it('asAccountId converts numeric POST body identifiers to strings', () => {
    const captureNoBody = makeCapture({
      url: 'https://api.bank.example/y',
      method: 'POST',
      postData: JSON.stringify({ accountId: 5551234 }),
      responseBody: { unrelated: 'value' },
    });
    const result = discoverAccountsInPool([captureNoBody]);
    expect(result.ids.length).toBe(1);
    expect(result.ids[0]).toBe('5551234');
  });
});

// ─── poolMaxContainer (bank-agnostic guards) ─────────────────────

describe('poolMaxContainer — bank-agnostic edges', () => {
  it('returns 0 on empty pool', () => {
    const max = poolMaxContainer([]);
    expect(max).toBe(0);
  });

  it('returns 0 when no endpoint exposes a named container', () => {
    const noise = makeCapture({
      url: 'https://api.bank.example/marketing',
      method: 'GET',
      responseBody: { promotion: 'hello' },
    });
    const max = poolMaxContainer([noise]);
    expect(max).toBe(0);
  });

  it('counts only records that pass looksLikeAccountRecord', () => {
    const noiseContainer = makeCapture({
      url: 'https://api.bank.example/cards-but-empty',
      method: 'GET',
      responseBody: { cardsList: [{ unrelated: 'no-id-field' }] },
    });
    const max = poolMaxContainer([noiseContainer]);
    expect(max).toBe(0);
  });
});
