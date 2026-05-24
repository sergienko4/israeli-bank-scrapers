/**
 * OneZero synthetic fetch mock — intercepts globalThis.fetch for the
 * OneZero identity + GraphQL API so the pipeline can be exercised
 * without network. Rule #18: every value is SYNTHETIC. No real PII.
 * Shared machinery lives in SyntheticFetchMockKit; this file declares
 * only the bank-specific dispatch + response payloads.
 *
 * The mock short-circuits the OTP flow via `otpLongTermToken`, so only
 * these endpoints need synthetic responses:
 *   - POST <identityBase>.../getIdToken
 *   - POST <identityBase>.../sessions/token
 *   - POST <graphqlUrl>  (operation-name dispatch)
 */

import type {
  IDispatchArgs,
  IMockHandle,
  IResponseLike,
} from '../Helpers/SyntheticFetchMockKit.js';
import { installSyntheticFetch, jsonOk, notFound } from '../Helpers/SyntheticFetchMockKit.js';

export type { IMockCallCounts, IMockHandle } from '../Helpers/SyntheticFetchMockKit.js';

/** Synthetic credentials for mock-mode runs — safe for public fixtures. */
export const ONEZERO_MOCK_CREDS = Object.freeze({
  email: 'synthetic-onezero@example.test',
  password: 'synthetic-pass',
  phoneNumber: '+972-546-218739',
  otpLongTermToken: 'syn-otp-long-term-a7f4b2c8',
});

const SYN_ID_TOKEN = 'syn-id-a7f4b2c8';
const SYN_ACCESS_TOKEN = 'syn-access-d3e9';
const SYN_PORTFOLIO_ID = 'portfolio-a7f4b2c8';
const SYN_PORTFOLIO_NUM = '40286139';
const SYN_ACCOUNT_ID = 'acct-b7c4';
const SYN_CURSOR_PAGE_TWO = 'next-page';
const SYN_CURSOR_NONE = '';
const SYN_BALANCE = 2850.6;

type JsonObject = Record<string, unknown>;

/** A single synthetic movement row. */
interface ISyntheticMovement extends JsonObject {
  readonly accountId: string;
  readonly bankCurrencyAmount: string;
  readonly bookingDate: string;
  readonly conversionRate: string;
  readonly creditDebit: string;
  readonly description: string;
  readonly isReversed: boolean;
  readonly movementAmount: string;
  readonly movementCurrency: string;
  readonly movementId: string;
  readonly movementTimestamp: string;
  readonly movementType: string;
  readonly portfolioId: string;
  readonly runningBalance: string;
  readonly valueDate: string;
}

/**
 * Build one synthetic movement record with the shape the mapper expects.
 * @param overrides - Per-row fields that differ from the baseline.
 * @returns A complete synthetic movement.
 */
function makeMovement(overrides: Partial<ISyntheticMovement>): ISyntheticMovement {
  const baseline: ISyntheticMovement = {
    accountId: SYN_ACCOUNT_ID,
    bankCurrencyAmount: '0',
    bookingDate: '2026-03-15',
    conversionRate: '1',
    creditDebit: 'DEBIT',
    description: 'synthetic row',
    isReversed: false,
    movementAmount: '0',
    movementCurrency: 'ILS',
    movementId: 'mov-000',
    movementTimestamp: '2026-03-15T10:00:00.000Z',
    movementType: 'SYNTHETIC',
    portfolioId: SYN_PORTFOLIO_ID,
    runningBalance: '0',
    valueDate: '2026-03-15',
  };
  return { ...baseline, ...overrides };
}

/** First-page movement rows (2 items). */
const PAGE_ONE_MOVEMENTS: readonly ISyntheticMovement[] = [
  makeMovement({
    movementId: 'mov-001',
    movementAmount: '47.50',
    creditDebit: 'DEBIT',
    description: 'synthetic coffee',
    runningBalance: '1850.00',
    movementTimestamp: '2026-03-15T10:00:00.000Z',
    valueDate: '2026-03-15',
  }),
  makeMovement({
    movementId: 'mov-002',
    movementAmount: '1200.00',
    creditDebit: 'CREDIT',
    description: 'synthetic refund',
    runningBalance: '3050.00',
    movementTimestamp: '2026-03-14T08:30:00.000Z',
    valueDate: '2026-03-14',
  }),
];

/** Second-page movement rows (1 item). */
const PAGE_TWO_MOVEMENTS: readonly ISyntheticMovement[] = [
  makeMovement({
    movementId: 'mov-003',
    movementAmount: '299.90',
    creditDebit: 'DEBIT',
    description: 'synthetic subscription',
    runningBalance: '1550.10',
    movementTimestamp: '2026-03-10T12:45:00.000Z',
    valueDate: '2026-03-10',
  }),
];

/**
 * Synthetic GetCustomer envelope — one portfolio, one account.
 * @returns GraphQL envelope.
 */
function customerEnvelope(): JsonObject {
  return {
    data: {
      customer: [
        {
          __typename: 'Customer',
          customerId: 'cust-syn-001',
          portfolios: [
            {
              __typename: 'Portfolio',
              portfolioId: SYN_PORTFOLIO_ID,
              portfolioNum: SYN_PORTFOLIO_NUM,
              accounts: [
                {
                  __typename: 'Account',
                  accountId: SYN_ACCOUNT_ID,
                  accountType: 'CHECKING',
                  currency: 'ILS',
                  status: 'ACTIVE',
                  subType: 'MAIN',
                },
              ],
            },
          ],
        },
      ],
    },
  };
}

/** Pagination payload for a movements envelope. */
interface IPagination {
  readonly cursor: string | null;
  readonly hasMore: boolean;
}

/**
 * Build a movements page envelope given the rows + pagination values.
 * @param movements - Rows to embed.
 * @param pagination - Cursor + hasMore state for the page.
 * @returns GraphQL envelope.
 */
function movementsEnvelope(
  movements: readonly ISyntheticMovement[],
  pagination: IPagination,
): JsonObject {
  return {
    data: {
      movements: {
        __typename: 'Movements',
        isRunningBalanceInSync: true,
        movements,
        pagination: {
          __typename: 'Pagination',
          cursor: pagination.cursor,
          hasMore: pagination.hasMore,
        },
      },
    },
  };
}

/**
 * Synthetic GetAccountBalance envelope.
 * @returns GraphQL envelope.
 */
function balanceEnvelope(): JsonObject {
  return {
    data: {
      balance: {
        currentAccountBalance: SYN_BALANCE,
        currentAccountBalanceStr: '2850.60',
        blockedAmountStr: '0',
        limitAmountStr: '10000',
      },
    },
  };
}

/** Parsed GraphQL request body slice — just enough to route by operation. */
interface IGraphqlRequestBody {
  readonly query?: string;
  readonly variables?: { readonly pagination?: { readonly cursor?: string | null } };
}

/**
 * Parse a fetch RequestInit body as a GraphQL request envelope.
 * @param init - Fetch init.
 * @returns Parsed body or empty when parsing fails.
 */
function parseGraphqlBody(init?: RequestInit): IGraphqlRequestBody {
  const raw = init?.body;
  if (typeof raw !== 'string') return {};
  try {
    return JSON.parse(raw) as IGraphqlRequestBody;
  } catch {
    return {};
  }
}

type Operation = 'customer' | 'movements' | 'balance' | 'unknown';

/**
 * Detect which GraphQL operation a query string requests.
 * @param query - Query string.
 * @returns Operation tag.
 */
function detectOperation(query: string): Operation {
  if (query.includes('GetCustomer')) return 'customer';
  if (query.includes('GetMovements')) return 'movements';
  if (query.includes('GetAccountBalance')) return 'balance';
  return 'unknown';
}

/**
 * Route a GetMovements request to page one or two depending on cursor.
 * @param body - Parsed request body.
 * @returns Response-like for the matching page.
 */
function routeMovements(body: IGraphqlRequestBody): IResponseLike {
  const cursor = body.variables?.pagination?.cursor ?? SYN_CURSOR_NONE;
  if (cursor === SYN_CURSOR_PAGE_TWO) {
    const pagination: IPagination = { cursor: null, hasMore: false };
    const envelope = movementsEnvelope(PAGE_TWO_MOVEMENTS, pagination);
    return jsonOk(envelope);
  }
  const pagination: IPagination = { cursor: SYN_CURSOR_PAGE_TWO, hasMore: true };
  const envelope = movementsEnvelope(PAGE_ONE_MOVEMENTS, pagination);
  return jsonOk(envelope);
}

/**
 * Route a GraphQL request to the matching synthetic envelope.
 * @param body - Parsed request body.
 * @returns Response-like envelope for the detected operation.
 */
function routeGraphql(body: IGraphqlRequestBody): IResponseLike {
  const operation = detectOperation(body.query ?? '');
  if (operation === 'customer') {
    const envelope = customerEnvelope();
    return jsonOk(envelope);
  }
  if (operation === 'balance') {
    const envelope = balanceEnvelope();
    return jsonOk(envelope);
  }
  if (operation === 'movements') return routeMovements(body);
  return jsonOk({ errors: [{ message: 'unknown mock graphql operation' }] });
}

/**
 * Route an identity request (getIdToken / sessions/token).
 * @param url - Request URL.
 * @returns Response-like envelope for the detected path.
 */
function routeIdentity(url: string): IResponseLike {
  if (url.includes('getIdToken')) return jsonOk({ resultData: { idToken: SYN_ID_TOKEN } });
  if (url.includes('sessions/token')) {
    return jsonOk({ resultData: { accessToken: SYN_ACCESS_TOKEN } });
  }
  return notFound('unknown mock identity route');
}

/**
 * Classify a URL into identity / graphql / unknown.
 * @param url - Resolved URL string.
 * @returns Classification tag.
 */
function classify(url: string): 'identity' | 'graphql' | 'unknown' {
  const isIdentity =
    url.includes('identity.') || url.includes('/getIdToken') || url.includes('/sessions/token');
  if (isIdentity) return 'identity';
  const isGraphql = url.includes('graphql') || url.includes('mobile-graph');
  if (isGraphql) return 'graphql';
  return 'unknown';
}

/**
 * OneZero dispatch — bank-specific URL → synthetic response routing.
 * @param args - URL + init + tally bundle.
 * @returns Response-like.
 */
function dispatchOneZero(args: IDispatchArgs): IResponseLike {
  const kind = classify(args.url);
  if (kind === 'identity') {
    args.tally.identity += 1;
    return routeIdentity(args.url);
  }
  if (kind === 'graphql') {
    args.tally.graphql += 1;
    const body = parseGraphqlBody(args.init);
    return routeGraphql(body);
  }
  return notFound('unknown mock route');
}

/**
 * Install the synthetic OneZero fetch mock.
 * @returns Handle with dispose + call-count inspector.
 */
export function installOneZeroFetchMock(): IMockHandle {
  return installSyntheticFetch({ dispatch: dispatchOneZero });
}
