import { createRequire } from 'node:module';

import { jest } from '@jest/globals';

interface IConsumerExports {
  readonly CompanyTypes: { readonly Leumi: string; readonly Pepper?: string };
  readonly createScraper: () => {
    readonly scrape: (credentials?: unknown) => Promise<unknown>;
  };
}

interface ISmoke {
  readonly runScrape: (exports: IConsumerExports, scenario?: string) => Promise<void>;
}

const SMOKE = createRequire(import.meta.url)(
  '../../../.github/scripts/ci/consumer-smoke.cjs',
) as ISmoke;
const PRIME_URL = 'https://hb2.bankleumi.co.il/H/Login.html';

describe('consumer install smoke isolation', () => {
  it.each([
    ['string', PRIME_URL],
    ['URL', new URL(PRIME_URL)],
    ['Request', new Request(PRIME_URL)],
  ] as const)('uses a synthetic response for a %s and restores fetch', async (_kind, input) => {
    const original = globalThis.fetch;
    const network = jest.fn(() => Promise.resolve(new Response(null, { status: 599 })));
    const log = jest.spyOn(console, 'log').mockImplementation(() => undefined);
    let status = 0;
    const scrape = jest.fn(async () => {
      status = (await fetch(input)).status;
      return { success: false };
    });
    const createScraper = jest.fn(() => ({ scrape }));
    globalThis.fetch = network;
    try {
      await SMOKE.runScrape({
        CompanyTypes: { Leumi: 'leumi' },
        createScraper,
      });
      expect(createScraper).toHaveBeenCalledWith({
        companyId: 'leumi',
        startDate: new Date('2026-01-01'),
      });
      expect(status).toBe(503);
      expect(network).not.toHaveBeenCalled();
      expect(globalThis.fetch).toBe(network);
    } finally {
      globalThis.fetch = original;
      log.mockRestore();
    }
  });

  it.each(['https://hb2.bankleumi.co.il/H/Wrong.html', 'https://bank.example/H/Login.html'])(
    'rejects an unexpected prime URL without network access: %s',
    async url => {
      const original = globalThis.fetch;
      const exitCode = process.exitCode;
      const network = jest.fn(() => Promise.resolve(new Response(null, { status: 599 })));
      const log = jest.spyOn(console, 'log').mockImplementation(() => undefined);
      const scrape = jest.fn(async () => {
        await fetch(url);
        return { success: false };
      });
      globalThis.fetch = network;
      try {
        await SMOKE.runScrape({
          CompanyTypes: { Leumi: 'leumi' },
          createScraper: jest.fn(() => ({ scrape })),
        });
        expect(process.exitCode).toBe(1);
        expect(log).toHaveBeenCalledWith('SETTLED throw Unexpected consumer prime URL');
        expect(log).not.toHaveBeenCalledWith('OFFLINE_REQUEST');
        expect(network).not.toHaveBeenCalled();
        expect(globalThis.fetch).toBe(network);
      } finally {
        globalThis.fetch = original;
        process.exitCode = exitCode;
        log.mockRestore();
      }
    },
  );

  it('restores fetch and reports a synchronous factory failure', async () => {
    const original = globalThis.fetch;
    const exitCode = process.exitCode;
    const log = jest.spyOn(console, 'log').mockImplementation(() => undefined);
    try {
      await SMOKE.runScrape({
        CompanyTypes: { Leumi: 'leumi' },
        createScraper: jest.fn(() => {
          throw new TypeError('synthetic factory failure');
        }),
      });
      expect(globalThis.fetch).toBe(original);
      expect(process.exitCode).toBe(1);
      expect(log).toHaveBeenCalledWith('SETTLED throw synthetic factory failure');
    } finally {
      globalThis.fetch = original;
      process.exitCode = exitCode;
      log.mockRestore();
    }
  });
});

const GRAPHQL_URL = 'https://fe-sec.pepper.co.il/graphql';
const ACCOUNT_ID = 'acct-syn-001';
const SECRET = 'bearer-secret-9f8e7d6c5b4a';

/** One request a fake library makes through the `fetch` the smoke installed. */
interface IRequest {
  readonly url: string;
  readonly init: RequestInit;
}

/** The fields each registered query selects, as the packed library sends them. */
const ACCOUNT_FIELDS = ['accountId', 'accountNumber'] as const;
const BALANCE_FIELDS = ['currentBalance'] as const;
const TXN_FIELDS = [
  'transactionId',
  'transactionAmount',
  'bookingDate',
  'effectiveDate',
  'currency',
  'description',
  'liquidityStatus',
] as const;

/** Field lists for the three queries; a test changes one to drop a selection. */
interface IQueryFields {
  readonly account: readonly string[];
  readonly balance: readonly string[];
  readonly posted: readonly string[];
  readonly pending: readonly string[];
}

const FULL_FIELDS: IQueryFields = {
  account: ACCOUNT_FIELDS,
  balance: BALANCE_FIELDS,
  posted: TXN_FIELDS,
  pending: TXN_FIELDS,
};

/** The three queries of one scrape, in the order the library sends them. */
interface IQuerySet {
  readonly user: string;
  readonly balance: string;
  readonly transactions: string;
}

/**
 * Build the three queries from their selected fields.
 * @param fields - The fields each query selects.
 * @returns The query texts.
 */
function buildQueries(fields: IQueryFields): IQuerySet {
  const account = fields.account.join(' ');
  const balance = fields.balance.join(' ');
  const posted = fields.posted.join(' ');
  const pending = fields.pending.join(' ');
  return {
    user: `query UserDataV2 { userDataV2 { getUserDataV2 { customerAndAccounts { customerId accounts { ${account} } } } } }`,
    balance: `query fetchAccountBalance($accountId: String!) { accounts { balance(accountId: $accountId) { ${balance} } } }`,
    transactions: `query Transactions($accountId: String!, $from: String) { accounts { oshTransactionsNew(accountId: $accountId, from: $from) { totalCount transactions { ${posted} } pendingTransactions { ${pending} } } } }`,
  };
}

/**
 * Build one request to the GraphQL endpoint.
 * @param query - The query text.
 * @param overrides - Parts of the request to change.
 * @returns The request.
 */
function graphqlRequest(query: string, overrides: Partial<IRequest> = {}): IRequest {
  const variables = { accountId: ACCOUNT_ID };
  const body = JSON.stringify({ query, variables });
  const headers = { authorization: 'WARM' };
  return { url: GRAPHQL_URL, init: { method: 'POST', body, headers }, ...overrides };
}

/**
 * The requests a library makes for a query set when nothing goes wrong.
 * @param queries - The query set.
 * @returns One request per query.
 */
function requestsFor(queries: IQuerySet): readonly IRequest[] {
  return [queries.user, queries.balance, queries.transactions].map(query => graphqlRequest(query));
}

/** The result a library returns when the synthetic data mapped correctly. */
const GOOD_RESULT = {
  success: true,
  accounts: [
    {
      accountNumber: '40286139',
      balance: 2850.6,
      txns: [
        {
          identifier: 'txn-1',
          chargedAmount: -12.5,
          date: '2026-03-10T00:00:00Z',
          originalCurrency: 'ILS',
          description: 'Synthetic coffee',
        },
        {
          identifier: 'txn-2',
          chargedAmount: -5,
          date: '2026-03-15T00:00:00Z',
          originalCurrency: 'USD',
          description: 'Synthetic pending',
        },
      ],
    },
  ],
};

/** Everything one run of the GraphQL scenario printed and did. */
interface IGraphqlRun {
  readonly lines: string[];
  readonly exitCode: typeof process.exitCode;
  readonly networkCalls: number;
  readonly isFetchRestored: boolean;
}

/** What a fake library does once the smoke has given it a token. */
type LibraryRun = (token: string) => Promise<unknown>;

/**
 * Send one request through the `fetch` the smoke installed, with the warm token filled in.
 * @param request - The request to send.
 * @param token - The token the smoke gave the library.
 * @param isSwallowing - Whether a rejection is hidden instead of propagated.
 * @returns True once the request settled.
 */
async function sendOne(request: IRequest, token: string, isSwallowing: boolean): Promise<true> {
  const headers = { ...(request.init.headers as Record<string, string>) };
  if (headers.authorization === 'WARM') headers.authorization = token;
  const sending = fetch(request.url, { ...request.init, headers });
  if (isSwallowing) await sending.catch(() => undefined);
  else await sending;
  return true;
}

/**
 * Send the requests one after another, in order.
 * @param requests - The requests, first to last.
 * @param token - The token the smoke gave the library.
 * @param isSwallowing - Whether a rejection is hidden instead of propagated.
 * @returns True once every request settled.
 */
async function sendAll(
  requests: readonly IRequest[],
  token: string,
  isSwallowing: boolean,
): Promise<true> {
  if (requests.length === 0) return true;
  await sendOne(requests[0], token, isSwallowing);
  const remaining = requests.slice(1);
  return sendAll(remaining, token, isSwallowing);
}

/**
 * A library that sends fixed requests and returns a fixed result.
 * @param requests - The requests to send.
 * @param result - What its `scrape` returns.
 * @param isSwallowing - Whether it hides a rejected request instead of failing.
 * @returns The library's run.
 */
function fixedLibrary(
  requests: readonly IRequest[],
  result: unknown,
  isSwallowing: boolean,
): LibraryRun {
  return async (token: string): Promise<unknown> => {
    await sendAll(requests, token, isSwallowing);
    return result;
  };
}

/** A served account, as far as the mapping reads it. */
interface IServedAccount {
  readonly accountId?: string;
  readonly accountNumber?: string;
}

/** A served transaction row, as far as the mapping reads it. */
interface IServedRow {
  readonly transactionId?: string;
  readonly transactionAmount?: number;
  readonly bookingDate?: string;
  readonly effectiveDate?: string;
  readonly currency?: string;
  readonly description?: string;
}

/** The data each of the three queries is answered with. */
interface IServedUser {
  readonly userDataV2: {
    readonly getUserDataV2: {
      readonly customerAndAccounts: readonly { readonly accounts: readonly IServedAccount[] }[];
    };
  };
}
interface IServedBalance {
  readonly accounts: { readonly balance: { readonly currentBalance?: number } };
}
interface IServedPage {
  readonly accounts: {
    readonly oshTransactionsNew: {
      readonly transactions?: readonly IServedRow[];
      readonly pendingTransactions?: readonly IServedRow[];
    };
  };
}

/**
 * Send one query and read the `data` the stub served for it.
 * @param query - The query text.
 * @param accountId - The account id to send, or false when the library has none yet.
 * @param token - The token the smoke gave the library.
 * @returns The served data.
 */
async function ask<T>(query: string, accountId: string | false, token: string): Promise<T> {
  const variables = accountId === false ? {} : { accountId };
  const body = JSON.stringify({ query, variables });
  const headers = { authorization: token };
  const response = await fetch(GRAPHQL_URL, { method: 'POST', headers, body });
  const parsed = (await response.json()) as { readonly data: T };
  return parsed.data;
}

/**
 * Map what was served into a result, the way the packed library does. Where a field is
 * absent it falls back as the real mapping does: the account number to the account id,
 * a missing balance to 0, and the date to the effective date.
 * @param account - The served account.
 * @param balance - The served balance.
 * @param page - The served transactions page.
 * @returns The scrape result.
 */
function mapServed(account: IServedAccount, balance: IServedBalance, page: IServedPage): unknown {
  const block = page.accounts.oshTransactionsNew;
  const rows = [...(block.transactions ?? []), ...(block.pendingTransactions ?? [])];
  const txns = rows.map(row => ({
    identifier: row.transactionId,
    chargedAmount: row.transactionAmount,
    date: row.bookingDate ?? row.effectiveDate,
    originalCurrency: row.currency,
    description: row.description,
  }));
  const accountNumber = account.accountNumber ?? account.accountId;
  const figure = balance.accounts.balance.currentBalance ?? 0;
  return { success: true, accounts: [{ accountNumber, balance: figure, txns }] };
}

/**
 * A library that sends the three queries and builds its result from what was served.
 * A rejected request fails the scrape, as the packed library's does.
 * @param queries - The queries it sends.
 * @returns The library's run.
 */
function mappingLibrary(queries: IQuerySet): LibraryRun {
  return async (token: string): Promise<unknown> => {
    try {
      const user = await ask<IServedUser>(queries.user, false, token);
      const account = user.userDataV2.getUserDataV2.customerAndAccounts[0].accounts[0];
      const accountId = account.accountId ?? false;
      const balance = await ask<IServedBalance>(queries.balance, accountId, token);
      const page = await ask<IServedPage>(queries.transactions, accountId, token);
      return mapServed(account, balance, page);
    } catch {
      return { success: false };
    }
  };
}

/**
 * Run the real smoke's GraphQL scenario with a fake library.
 * @param library - What the fake library does with the token it is given.
 * @returns What the run printed and did.
 */
async function runScenario(library: LibraryRun): Promise<IGraphqlRun> {
  const original = globalThis.fetch;
  const exitCode = process.exitCode;
  const network = jest.fn(() => Promise.resolve(new Response(null, { status: 599 })));
  const log = jest.spyOn(console, 'log').mockImplementation(() => undefined);
  const scrape = jest.fn((credentials?: unknown) => {
    const { otpLongTermToken } = credentials as { otpLongTermToken: string };
    return library(otpLongTermToken);
  });
  globalThis.fetch = network;
  try {
    await SMOKE.runScrape(
      {
        CompanyTypes: { Leumi: 'leumi', Pepper: 'pepper' },
        createScraper: jest.fn(() => ({ scrape })),
      },
      'pepper-graphql',
    );
    const lines = log.mock.calls.map(call => String(call[0]));
    return {
      lines,
      exitCode: process.exitCode,
      networkCalls: network.mock.calls.length,
      isFetchRestored: globalThis.fetch === network,
    };
  } finally {
    globalThis.fetch = original;
    process.exitCode = exitCode;
    log.mockRestore();
  }
}

/**
 * Run the scenario with a library that sends fixed requests and returns a fixed result.
 * @param requests - The requests it sends.
 * @param result - What its `scrape` returns.
 * @param isSwallowing - Whether it hides a rejected request instead of failing.
 * @returns What the run printed and did.
 */
function runGraphql(
  requests: readonly IRequest[],
  result: unknown,
  isSwallowing: boolean,
): Promise<IGraphqlRun> {
  const library = fixedLibrary(requests, result, isSwallowing);
  return runScenario(library);
}

const FULL_QUERIES = buildQueries(FULL_FIELDS);
const VALID_REQUESTS = requestsFor(FULL_QUERIES);

/**
 * `FULL_FIELDS` with one query's selection replaced.
 * @param change - The selection to replace.
 * @returns The field lists.
 */
function withFields(change: Partial<IQueryFields>): IQueryFields {
  return { ...FULL_FIELDS, ...change };
}

/**
 * A field list without one field.
 * @param fields - The list.
 * @param dropped - The field to remove.
 * @returns The remaining fields.
 */
function minus(fields: readonly string[], dropped: string): readonly string[] {
  return fields.filter(field => field !== dropped);
}

/** One selection a regression could drop, and the check of the typed result that must catch it. */
interface IDroppedSelection {
  readonly name: string;
  readonly change: Partial<IQueryFields>;
  readonly check: string;
}

const DROPPED_SELECTIONS: readonly IDroppedSelection[] = [
  {
    name: 'transactionId from posted rows',
    change: { posted: minus(TXN_FIELDS, 'transactionId') },
    check: 'transaction identifiers',
  },
  {
    name: 'transactionId from pending rows',
    change: { pending: minus(TXN_FIELDS, 'transactionId') },
    check: 'transaction identifiers',
  },
  {
    name: 'transactionAmount from posted rows',
    change: { posted: minus(TXN_FIELDS, 'transactionAmount') },
    check: 'transaction amounts',
  },
  {
    name: 'transactionAmount from pending rows',
    change: { pending: minus(TXN_FIELDS, 'transactionAmount') },
    check: 'transaction amounts',
  },
  {
    name: 'bookingDate from posted rows',
    change: { posted: minus(TXN_FIELDS, 'bookingDate') },
    check: 'transaction dates',
  },
  {
    name: 'bookingDate from pending rows',
    change: { pending: minus(TXN_FIELDS, 'bookingDate') },
    check: 'transaction dates',
  },
  {
    name: 'currency from posted rows',
    change: { posted: minus(TXN_FIELDS, 'currency') },
    check: 'transaction currencies',
  },
  {
    name: 'currency from pending rows',
    change: { pending: minus(TXN_FIELDS, 'currency') },
    check: 'transaction currencies',
  },
  {
    name: 'description from posted rows',
    change: { posted: minus(TXN_FIELDS, 'description') },
    check: 'transaction descriptions',
  },
  {
    name: 'description from pending rows',
    change: { pending: minus(TXN_FIELDS, 'description') },
    check: 'transaction descriptions',
  },
  {
    name: 'currentBalance from the balance query',
    change: { balance: ['availableBalance'] },
    check: 'balance',
  },
  {
    name: 'accountNumber from the account list',
    change: { account: minus(ACCOUNT_FIELDS, 'accountNumber') },
    check: 'account number',
  },
];

describe('consumer smoke GraphQL scenario', () => {
  it('[GQL-1] serves the registered operations and verifies the typed result', async () => {
    const library = mappingLibrary(FULL_QUERIES);
    const run = await runScenario(library);
    expect(run.lines).toContain('GRAPHQL_OPERATIONS Transactions,UserDataV2,fetchAccountBalance');
    expect(run.lines).toContain('GRAPHQL_UNEXPECTED 0');
    expect(run.lines).toContain('GRAPHQL_VERDICT ok');
    expect(run.networkCalls).toBe(0);
    expect(run.isFetchRestored).toBe(true);
  });

  it.each(DROPPED_SELECTIONS)('[GQL-9] catches a query that drops $name', async row => {
    const fields = withFields(row.change);
    const queries = buildQueries(fields);
    const library = mappingLibrary(queries);
    const run = await runScenario(library);
    expect(run.lines).toContain('GRAPHQL_UNEXPECTED 0');
    expect(run.lines).toContain(`GRAPHQL_VERDICT mismatch: ${row.check}`);
  });

  it('[GQL-10] catches a query that drops accountId, since the account-scoped queries lose it', async () => {
    const withoutId = minus(ACCOUNT_FIELDS, 'accountId');
    const fields = withFields({ account: withoutId });
    const queries = buildQueries(fields);
    const library = mappingLibrary(queries);
    const run = await runScenario(library);
    expect(run.lines).toContain('GRAPHQL_UNEXPECTED 1 variables fetchAccountBalance');
    expect(run.lines).toContain('GRAPHQL_VERDICT mismatch: success');
    expect(run.networkCalls).toBe(0);
  });

  it.each([
    [
      'an unrelated host',
      { url: 'https://bank.example/graphql' },
      'url https://bank.example/graphql',
    ],
    [
      'another path on the right host',
      { url: 'https://fe-sec.pepper.co.il/other' },
      'url https://fe-sec.pepper.co.il/other',
    ],
    ['a GET', { init: { method: 'GET' } }, 'method GET'],
    [
      'a bearer the library was not given',
      { init: { method: 'POST', headers: { authorization: 'other' }, body: '{}' } },
      'authorization',
    ],
  ] as const)(
    '[GQL-2] fails closed on %s and never reaches the network',
    async (_name, change, reason) => {
      const request = graphqlRequest(FULL_QUERIES.user, change);
      const run = await runGraphql([request], GOOD_RESULT, true);
      expect(run.lines).toContain(`GRAPHQL_UNEXPECTED 1 ${reason}`);
      expect(run.networkCalls).toBe(0);
      expect(run.isFetchRestored).toBe(true);
    },
  );

  it.each([
    ['an operation the registry does not hold', 'query Surprise { x }', 'operation'],
    [
      'a query that aliases a field',
      'query fetchAccountBalance { b: accounts { balance } }',
      'selection fetchAccountBalance',
    ],
    [
      'a query that spreads a fragment',
      'query fetchAccountBalance { ...Balance }',
      'selection fetchAccountBalance',
    ],
    [
      'a query with an unclosed selection',
      'query fetchAccountBalance { accounts {',
      'selection fetchAccountBalance',
    ],
  ] as const)('[GQL-3] fails closed on %s', async (_name, query, reason) => {
    const run = await runGraphql([graphqlRequest(query)], GOOD_RESULT, true);
    expect(run.lines).toContain(`GRAPHQL_UNEXPECTED 1 ${reason}`);
    expect(run.networkCalls).toBe(0);
  });

  it('[GQL-4] fails closed on an account-scoped query that lost its account id', async () => {
    const lost = graphqlRequest(FULL_QUERIES.transactions);
    const body = JSON.stringify({ query: FULL_QUERIES.transactions, variables: {} });
    const run = await runGraphql([{ ...lost, init: { ...lost.init, body } }], GOOD_RESULT, true);
    expect(run.lines).toContain('GRAPHQL_UNEXPECTED 1 variables Transactions');
  });

  it('[GQL-5] names a rejected URL by origin and path only, never its query string', async () => {
    const leaky = `https://bank.example/graphql?token=${SECRET}#frag`;
    const run = await runGraphql(
      [graphqlRequest(FULL_QUERIES.user, { url: leaky })],
      GOOD_RESULT,
      true,
    );
    expect(run.lines).toContain('GRAPHQL_UNEXPECTED 1 url https://bank.example/graphql');
    const printed = run.lines.join('\n');
    expect(printed).not.toContain(SECRET);
  });

  it('[GQL-6] a library that does not hide the rejection settles as a thrown failure', async () => {
    const bad = graphqlRequest(FULL_QUERIES.user, { url: 'https://bank.example/graphql' });
    const run = await runGraphql([bad], GOOD_RESULT, false);
    expect(run.lines).toContain('SETTLED throw Unexpected consumer GraphQL request');
    expect(run.exitCode).toBe(1);
    expect(run.networkCalls).toBe(0);
  });

  it.each([
    [
      'a balance that is not the served one',
      { ...GOOD_RESULT, accounts: [{ ...GOOD_RESULT.accounts[0], balance: 2850 }] },
      'balance',
    ],
    [
      'a missing transaction',
      {
        ...GOOD_RESULT,
        accounts: [{ ...GOOD_RESULT.accounts[0], txns: GOOD_RESULT.accounts[0].txns.slice(1) }],
      },
      'two transactions',
    ],
    ['a failed scrape', { success: false }, 'success'],
    ['no accounts', { success: true, accounts: [] }, 'one account'],
  ] as const)(
    '[GQL-7] rejects %s even though every request was valid',
    async (_name, result, check) => {
      const run = await runGraphql(VALID_REQUESTS, result, false);
      expect(run.lines).toContain(`GRAPHQL_VERDICT mismatch: ${check}`);
      expect(run.lines).toContain('GRAPHQL_UNEXPECTED 0');
    },
  );

  it('[GQL-8] reports an unknown scenario as a failure without running anything', async () => {
    const log = jest.spyOn(console, 'log').mockImplementation(() => undefined);
    const exitCode = process.exitCode;
    const createScraper = jest.fn();
    try {
      await SMOKE.runScrape(
        { CompanyTypes: { Leumi: 'leumi' }, createScraper },
        'no-such-scenario',
      );
      expect(log).toHaveBeenCalledWith(
        'SETTLED throw Unknown consumer smoke scenario no-such-scenario',
      );
      expect(process.exitCode).toBe(1);
      expect(createScraper).not.toHaveBeenCalled();
    } finally {
      process.exitCode = exitCode;
      log.mockRestore();
    }
  });
});
