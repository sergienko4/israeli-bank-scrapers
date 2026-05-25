/**
 * Cross-bank shape registry consumed by ApiDirectScrapePhase.test.ts.
 *
 * The ApiDirectScrape phase is bank-agnostic by design — its parameterized
 * tests must therefore exercise the real {@link PEPPER_SHAPE} and
 * {@link ONE_ZERO_SHAPE} extractor chains, not just a synthetic stand-in.
 * Each case carries router fixtures shaped to satisfy the real extractor
 * expectations of its bound shape, plus optional metadata (fallback
 * balance, stop predicate, extra-headers) so the test file stays
 * shape-agnostic. Adding a new bank is additive: drop one more
 * IApiDirectScrapeBankShapeCase into ALL_BANK_CASES.
 */

import { ONE_ZERO_SHAPE } from '../../../../../Scrapers/Pipeline/Banks/OneZero/scrape/OneZeroShape.js';
import type { IOneZeroAcct } from '../../../../../Scrapers/Pipeline/Banks/OneZero/scrape/OneZeroShapeHelpers.js';
import { PEPPER_SHAPE } from '../../../../../Scrapers/Pipeline/Banks/Pepper/scrape/PepperShape.js';
import type { IPepperAcct } from '../../../../../Scrapers/Pipeline/Banks/Pepper/scrape/PepperShapeHelpers.js';
import type {
  HeaderMap,
  IApiDirectScrapeShape,
} from '../../../../../Scrapers/Pipeline/Phases/ApiDirectScrape/IApiDirectScrapeShape.js';
import type { IActionContext } from '../../../../../Scrapers/Pipeline/Types/PipelineContext.js';

/** Headers value (static or dynamic) accepted by IApiDirectScrapeShape steps. */
type HeadersLike = HeaderMap | ((ctx: IActionContext) => HeaderMap);

/**
 * Per-bank fixtures consumed by the parameterized phase tests.
 *
 * Fixtures must round-trip through the real shape's extractors. Pepper
 * pages are 1-based with a `totalCount` terminator; OneZero pages
 * carry a string cursor with `hasMore`. The `transactionsPaged`
 * fixture is the terminal page reachable after the first page returns
 * a non-false cursor — used by ADS-ACT-2 to prove the stop predicate
 * fires before the second fetch.
 */
interface IApiDirectScrapeFixtures {
  readonly customer: Record<string, unknown>;
  readonly balance: Record<string, unknown>;
  readonly transactions: Record<string, unknown>;
  readonly transactionsPaged: Record<string, unknown>;
  readonly fallbackBalance?: number;
  readonly stopPredicate?: (acc: readonly object[]) => boolean;
  readonly extraHeaders?: HeadersLike;
  /** Expected display number of the first account in `customer`. */
  readonly expectedAccountNumber: string;
  /** Expected balance value extracted from `balance`. */
  readonly expectedBalance: number;
}

/**
 * Parameterised case wiring a real shape to fixtures shaped for its extractors.
 *
 * @template TAcct - Account-ref type emitted by `shape.customer.extractAccounts`.
 * @template TCursor - Pagination cursor type accepted by `shape.transactions`.
 */
interface IApiDirectScrapeBankShapeCase<TAcct, TCursor> {
  readonly name: string;
  readonly shape: IApiDirectScrapeShape<TAcct, TCursor>;
  readonly fixtures: IApiDirectScrapeFixtures;
}

/** Synthetic account ref — minimum payload the synthetic shape needs. */
interface ISynAcct {
  readonly id: string;
  readonly num: string;
}

/**
 * Synthetic accountNumberOf — passthrough on `num`.
 * @param a - Account ref.
 * @returns Display number.
 */
function synAccountNumberOf(a: ISynAcct): string {
  return a.num;
}

/**
 * Synthetic empty-vars helper (customer query needs no variables).
 * @returns Empty record.
 */
function synEmptyVars(): Record<string, unknown> {
  return {};
}

/**
 * Synthetic extractAccounts — unified scrape-shape signature.
 * @param args - Extract-args bundle (uses `args.body` only).
 * @param args.body - Hydrated response body.
 * @returns Account list.
 */
function synExtractAccounts(args: { readonly body: Record<string, unknown> }): readonly ISynAcct[] {
  return (args.body as { accts: readonly ISynAcct[] }).accts;
}

/**
 * Synthetic balance extractor.
 * @param body - Balance response body.
 * @returns Balance value.
 */
function synBalExtract(body: Record<string, unknown>): number {
  return (body as { balance: number }).balance;
}

/**
 * Synthetic balance vars builder.
 * @param a - Account ref.
 * @returns Variables map keyed by id.
 */
function synBalVars(a: ISynAcct): Record<string, unknown> {
  return { id: a.id };
}

/**
 * Synthetic txns vars builder.
 * @param a - Account ref.
 * @returns Variables map keyed by id.
 */
function synTxnVars(a: ISynAcct): Record<string, unknown> {
  return { id: a.id };
}

/**
 * Synthetic extractPage — unified scrape-shape signature.
 * @param args - Extract-args bundle (uses `args.body` only).
 * @param args.body - Hydrated response body.
 * @returns Generic page.
 */
function synExtractPage(args: { readonly body: Record<string, unknown> }): {
  readonly items: readonly object[];
  readonly nextCursor: string | false;
} {
  return args.body as unknown as {
    readonly items: readonly object[];
    readonly nextCursor: string | false;
  };
}

/** Synthetic shape (string cursor) — mirrors OneZero's cursor type. */
const SYN_SHAPE: IApiDirectScrapeShape<ISynAcct, string> = {
  stepName: 'AdsTestSyntheticShape',
  accountNumberOf: synAccountNumberOf,
  customer: { buildVars: synEmptyVars, extractAccounts: synExtractAccounts },
  balance: { buildVars: synBalVars, extract: synBalExtract },
  transactions: { buildVars: synTxnVars, extractPage: synExtractPage },
};

/** Synthetic case — fixtures shaped to mirror the legacy `makeShape` tests. */
const SYN_CASE: IApiDirectScrapeBankShapeCase<ISynAcct, string> = {
  name: 'synthetic',
  shape: SYN_SHAPE,
  fixtures: {
    customer: { accts: [{ id: 'syn-a1', num: 'syn-num-1' }] },
    balance: { balance: 42 },
    transactions: { items: [{ k: 1 }], nextCursor: false },
    transactionsPaged: { items: [{ k: 2 }], nextCursor: false },
    expectedAccountNumber: 'syn-num-1',
    expectedBalance: 42,
  },
};

/**
 * Pepper fixtures — extractor source citations:
 *   PepperShapeHelpers.ts:39 — `userDataV2?.getUserDataV2?.customerAndAccounts`
 *   PepperShapeHelpers.ts:60 — `accounts?.balance?.currentBalance`
 *   PepperShapeTxns.ts:119 — `accounts?.oshTransactionsNew` (transactions + pendingTransactions + totalCount)
 */
const PEPPER_CASE: IApiDirectScrapeBankShapeCase<IPepperAcct, number> = {
  name: 'pepper',
  shape: PEPPER_SHAPE,
  fixtures: {
    customer: {
      userDataV2: {
        getUserDataV2: {
          customerAndAccounts: [
            {
              customerId: 'pep-cust-1',
              accounts: [{ accountId: 'pep-acc-1', accountNumber: 'pep-num-1' }],
            },
          ],
        },
      },
    },
    balance: { accounts: { balance: { currentBalance: 1234 } } },
    transactions: {
      accounts: {
        oshTransactionsNew: {
          totalCount: 1,
          transactions: [{ id: 'pep-txn-1' }],
          pendingTransactions: [],
        },
      },
    },
    transactionsPaged: {
      accounts: {
        oshTransactionsNew: { totalCount: 1, transactions: [], pendingTransactions: [] },
      },
    },
    expectedAccountNumber: 'pep-num-1',
    expectedBalance: 1234,
  },
};

/**
 * OneZero fixtures — extractor source citations:
 *   OneZeroShapeHelpers.ts:72 — `customer[].portfolios[].accounts[]`
 *   OneZeroShapeHelpers.ts:108 — `balance.currentAccountBalance`
 *   OneZeroShapeTxns.ts:73 — `movements.movements` + `movements.pagination.{cursor,hasMore}`
 */
const ONEZERO_CASE: IApiDirectScrapeBankShapeCase<IOneZeroAcct, string> = {
  name: 'onezero',
  shape: ONE_ZERO_SHAPE,
  fixtures: {
    customer: {
      customer: [
        {
          portfolios: [
            {
              portfolioId: 'oz-pfo-1',
              portfolioNum: 'oz-num-1',
              accounts: [{ accountId: 'oz-acc-1' }],
            },
          ],
        },
      ],
    },
    balance: { balance: { currentAccountBalance: 9999 } },
    transactions: {
      movements: { movements: [{ id: 'oz-txn-1' }], pagination: { cursor: null, hasMore: false } },
    },
    transactionsPaged: {
      movements: { movements: [], pagination: { cursor: null, hasMore: false } },
    },
    fallbackBalance: 0,
    expectedAccountNumber: 'oz-num-1',
    expectedBalance: 9999,
  },
};

/** Tagged-union parameter array consumed by `describe.each`. */
type AnyBankCase = IApiDirectScrapeBankShapeCase<unknown, unknown>;
const ALL_BANK_CASES: readonly AnyBankCase[] = [
  SYN_CASE as unknown as AnyBankCase,
  PEPPER_CASE as unknown as AnyBankCase,
  ONEZERO_CASE as unknown as AnyBankCase,
];

export type { AnyBankCase, IApiDirectScrapeBankShapeCase, IApiDirectScrapeFixtures };
export { ALL_BANK_CASES, ONEZERO_CASE, PEPPER_CASE, SYN_CASE };
