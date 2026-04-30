/**
 * Pepper synthetic fetch mock — intercepts globalThis.fetch for the
 * Pepper Transmit + GraphQL API so the pipeline can be exercised without
 * network. Rule #18: every value is SYNTHETIC (no real PII).
 */

/** Tally values for wiring assertions. */
export interface IMockCallCounts {
  readonly identity: number;
  readonly graphql: number;
}

/** Installer handle. */
export interface IMockHandle {
  readonly dispose: () => boolean;
  readonly callCounts: () => IMockCallCounts;
}

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
const MIN_OK = 200;
const MAX_OK = 300;

type JsonObject = Record<string, unknown>;

/** Minimal Headers stub used by NativeFetchStrategy.emitSetCookies. */
interface IHeadersLike {
  readonly getSetCookie: () => readonly string[];
}

/** Minimal Response shape the project consumes. */
interface IResponseLike {
  readonly ok: boolean;
  readonly status: number;
  readonly text: () => Promise<string>;
  readonly headers: IHeadersLike;
}

/** Accumulates call counts. */
interface ICallTally {
  identity: number;
  graphql: number;
}

/**
 * Build a Response-like object.
 * @param status - HTTP status.
 * @param bodyText - Serialized body.
 * @returns Response-like object.
 */
function buildResponse(status: number, bodyText: string): IResponseLike {
  const isOk = status >= MIN_OK && status < MAX_OK;
  /**
   * Closure returning the captured body.
   * @returns Body text promise.
   */
  const textFn = (): Promise<string> => Promise.resolve(bodyText);
  const headers: IHeadersLike = { getSetCookie: noopCookies };
  return { ok: isOk, status, text: textFn, headers };
}

/**
 * Empty cookie header accessor — stable reference used by all synthetic responses.
 * @returns Empty frozen cookie array.
 */
function noopCookies(): readonly string[] {
  return [];
}

/**
 * Wrap a JSON object as a 200 Response-like.
 * @param payload - JSON-serializable payload.
 * @returns 200 Response-like.
 */
function jsonOk(payload: JsonObject): IResponseLike {
  const bodyText = JSON.stringify(payload);
  return buildResponse(200, bodyText);
}

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
 * Map a GraphQL queryname to the synthetic response.
 * @param queryname - queryname header value.
 * @returns JSON envelope for that operation.
 */
function graphqlByName(queryname: string): JsonObject {
  if (queryname === 'UserDataV2') return userDataV2Response();
  if (queryname === 'fetchAccountBalance') return balanceResponse();
  return transactionsResponse();
}

/**
 * Pick the queryname header from a RequestInit.
 * @param init - Request init (may be absent).
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
 * Handle a bind or assert auth URL.
 * @param url - Target URL.
 * @param init - Request init (body carries the assertion type).
 * @returns Response-like.
 */
function dispatchAuth(url: string, init?: RequestInit): IResponseLike {
  if (url.includes('/auth/bind')) {
    const bind = bindResponse();
    return jsonOk(bind);
  }
  const body = typeof init?.body === 'string' ? init.body : '';
  if (body.includes('"password"')) {
    const pwd = assertPwdResponse();
    return jsonOk(pwd);
  }
  const otp = assertOtpResponse();
  return jsonOk(otp);
}

/** Args bundle for dispatch (respects the 3-param ceiling). */
interface IDispatchArgs {
  readonly url: string;
  readonly init?: RequestInit;
  readonly tally: ICallTally;
}

/**
 * Dispatch a URL + RequestInit to a synthetic response.
 * @param args - URL + init + tally bundle.
 * @returns Response-like.
 */
function dispatch(args: IDispatchArgs): IResponseLike {
  if (args.url.includes('/auth/')) {
    args.tally.identity += 1;
    return dispatchAuth(args.url, args.init);
  }
  if (args.url.includes('/graphql')) {
    args.tally.graphql += 1;
    const qn = pickQueryname(args.init);
    const envelope = graphqlByName(qn);
    return jsonOk(envelope);
  }
  const notFoundText = JSON.stringify({ message: `unmocked: ${args.url}` });
  return buildResponse(404, notFoundText);
}

/**
 * Resolve a fetch input to its URL string form.
 * @param input - URL, Request, or string from fetch().
 * @returns URL string.
 */
function resolveUrl(input: RequestInfo | URL): string {
  if (input instanceof URL) return input.href;
  if (typeof input === 'string') return input;
  return input.url;
}

/**
 * Build the mock fetch closure.
 * @param tally - Call count accumulator.
 * @returns Fetch-like function.
 */
function makeMockFetch(tally: ICallTally): typeof globalThis.fetch {
  /**
   * Mock fetch handler — synchronous dispatch + promise wrap.
   * @param input - URL or Request.
   * @param init - Request init.
   * @returns Response-like Promise.
   */
  async function mockFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
    await Promise.resolve();
    const url = resolveUrl(input);
    const resp = dispatch({ url, init, tally });
    return resp as unknown as Response;
  }
  return mockFetch;
}

/**
 * Install the synthetic fetch mock.
 * @returns Handle that restores original fetch + exposes call counts.
 */
export function installPepperFetchMock(): IMockHandle {
  const previousFetch = globalThis.fetch;
  const tally: ICallTally = { identity: 0, graphql: 0 };
  const mockFetch = makeMockFetch(tally);
  (globalThis as unknown as { fetch: typeof globalThis.fetch }).fetch = mockFetch;
  /**
   * Restore the original fetch.
   * @returns True once restored.
   */
  const dispose = (): boolean => {
    globalThis.fetch = previousFetch;
    return true;
  };
  /**
   * Snapshot the call counts.
   * @returns Frozen identity + graphql tallies.
   */
  const callCounts = (): IMockCallCounts => ({
    identity: tally.identity,
    graphql: tally.graphql,
  });
  return { dispose, callCounts };
}
