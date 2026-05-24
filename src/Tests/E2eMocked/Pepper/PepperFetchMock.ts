/**
 * Pepper synthetic fetch mock — intercepts globalThis.fetch for the
 * Pepper Transmit + GraphQL API so the pipeline can be exercised
 * without network. Rule #18: every value is SYNTHETIC (no real PII).
 * Shared machinery (Response shaping, tally tracking, globalThis.fetch
 * swap, Camoufox setFakePageEvalMode toggle) lives in
 * SyntheticFetchMockKit; this file declares only the bank-specific
 * dispatch + response payloads.
 */

import type {
  IDispatchArgs,
  IMockHandle,
  IResponseLike,
} from '../Helpers/SyntheticFetchMockKit.js';
import { installSyntheticFetch, jsonOk, notFound } from '../Helpers/SyntheticFetchMockKit.js';

export type { IMockCallCounts, IMockHandle } from '../Helpers/SyntheticFetchMockKit.js';

/** Synthetic credentials — safe for public fixtures. */
export const PEPPER_MOCK_CREDS = Object.freeze({
  phoneNumber: '+972-5fixt-mock1',
  password: 'fixt-m-pep-9b1d',
  otpLongTermToken: 'syn-pepper-long-term-a7f4b2c8',
});

const SYN_JWT = 'syn-jwt-a7f4b2c8';
const SYN_ACCOUNT_ID = 'acct-pep-001';
const SYN_ACCOUNT_NUMBER = '40286139';
const SYN_CUSTOMER_ID = 'cust-pep-001';
const SYN_BALANCE = 2850.6;

type JsonObject = Record<string, unknown>;

/**
 * Synthetic Transmit bind response — includes session/device headers
 * so step-2 and step-3 can carry them into their URL query params.
 * @returns Bind envelope carrying challenge + password assertion.
 */
function bindResponse(): JsonObject {
  return {
    error_code: 0,
    data: {
      challenge: 'syn-challenge',
      state: 'pending',
      control_flow: [
        { type: 'auth', methods: [{ type: 'password', assertion_id: 'syn-pwd-assert' }] },
      ],
    },
    headers: [
      { type: 'session_id', session_id: 'syn-session-id' },
      { type: 'device_id', device_id: 'syn-device-id' },
    ],
  };
}

/**
 * Synthetic Transmit assert(password) response.
 * @returns Assert envelope carrying the SMS OTP channel assertion.
 */
function assertPwdResponse(): JsonObject {
  return {
    data: {
      state: 'pending',
      control_flow: [
        {
          type: 'auth',
          methods: [{ channels: [{ type: 'sms', assertion_id: 'syn-otp-assert' }] }],
        },
      ],
    },
  };
}

/**
 * Synthetic Transmit assert(otp) response.
 * @returns Assert envelope carrying the final JWT.
 */
function assertOtpResponse(): JsonObject {
  return { data: { state: 'success', token: SYN_JWT } };
}

/**
 * Synthetic UserDataV2 response.
 * @returns Customer + accounts envelope.
 */
function userDataV2Response(): JsonObject {
  return {
    data: {
      userDataV2: {
        getUserDataV2: {
          customerAndAccounts: [
            {
              customerId: SYN_CUSTOMER_ID,
              accounts: [{ accountId: SYN_ACCOUNT_ID, accountNumber: SYN_ACCOUNT_NUMBER }],
            },
          ],
        },
      },
    },
  };
}

/**
 * Synthetic balance response.
 * @returns Balance envelope carrying currentBalance.
 */
function balanceResponse(): JsonObject {
  return { data: { accounts: { balance: { currentBalance: SYN_BALANCE } } } };
}

/**
 * Synthetic transactions response (single page).
 * @returns Transactions envelope with 1 posted + 1 pending row.
 */
function transactionsResponse(): JsonObject {
  return {
    data: {
      accounts: {
        oshTransactionsNew: {
          totalCount: 2,
          transactions: [
            {
              transactionId: 'txn-1',
              transactionAmount: -12.5,
              bookingDate: '2026-03-10T00:00:00Z',
              effectiveDate: '2026-03-10T00:00:00Z',
              currency: 'ILS',
              description: 'Synthetic coffee',
            },
          ],
          pendingTransactions: [
            {
              transactionId: 'txn-2',
              transactionAmount: -5,
              bookingDate: '2026-03-15T00:00:00Z',
              effectiveDate: '2026-03-15T00:00:00Z',
              currency: 'ILS',
              description: 'Synthetic pending',
              liquidityStatus: 'pending',
            },
          ],
        },
      },
    },
  };
}

/**
 * Pick the queryname header from a RequestInit (used to route GraphQL).
 * @param init - Fetch init (may be absent).
 * @returns queryname string ('' when missing).
 */
function pickQueryname(init?: RequestInit): string {
  const raw = init?.headers as Record<string, string> | undefined;
  if (!raw) return '';
  const name = raw.queryname;
  if (!name) return '';
  return name;
}

/**
 * Map a GraphQL queryname to the synthetic envelope.
 * @param queryname - queryname header value.
 * @returns JSON envelope for that operation.
 */
function graphqlByName(queryname: string): JsonObject {
  if (queryname === 'UserDataV2') return userDataV2Response();
  if (queryname === 'fetchAccountBalance') return balanceResponse();
  return transactionsResponse();
}

/**
 * Dispatch a Transmit auth request (bind / assert password / assert OTP).
 * @param url - Request URL.
 * @param init - Request init (body carries the assertion type).
 * @returns Response-like.
 */
function handleAuth(url: string, init?: RequestInit): IResponseLike {
  if (url.includes('/auth/bind')) {
    const envelope = bindResponse();
    return jsonOk(envelope);
  }
  const body = typeof init?.body === 'string' ? init.body : '';
  if (body.includes('"password"')) {
    const envelope = assertPwdResponse();
    return jsonOk(envelope);
  }
  const envelope = assertOtpResponse();
  return jsonOk(envelope);
}

/**
 * Pepper dispatch — bank-specific URL → synthetic response routing.
 * @param args - URL + init + tally bundle.
 * @returns Response-like.
 */
function dispatchPepper(args: IDispatchArgs): IResponseLike {
  const isAuthUrl = args.url.includes('/auth/');
  if (isAuthUrl) {
    args.tally.identity += 1;
    return handleAuth(args.url, args.init);
  }
  const isGraphqlUrl = args.url.includes('/graphql');
  if (isGraphqlUrl) {
    args.tally.graphql += 1;
    const queryname = pickQueryname(args.init);
    const envelope = graphqlByName(queryname);
    return jsonOk(envelope);
  }
  return notFound(`unmocked: ${args.url}`);
}

/**
 * Install the synthetic Pepper fetch mock.
 * @returns Handle that restores original fetch + exposes call counts.
 */
export function installPepperFetchMock(): IMockHandle {
  return installSyntheticFetch({ dispatch: dispatchPepper });
}
