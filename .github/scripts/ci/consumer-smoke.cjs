/**
 * The smallest program a consumer can write, run exactly as a consumer runs it.
 *
 * WHY THIS EXISTS
 * ---------------
 * Every other test in this repo runs from the working tree, with
 * devDependencies installed and `CI` set. Issue #552 is a defect of the
 * *published artifact* under a *consumer's* environment, so none of them can
 * see it. This file is deliberately naive: it requires the package by name,
 * starts one scrape, and prints whatever it gets back.
 *
 * Two properties are being proved, and both are invisible from inside the repo:
 *
 *   1. The scrape SETTLES. A pipeline that awaits an unref'd timer lets Node
 *      empty its event loop and exit 0 mid-run, so the consumer gets no result
 *      and no error. That is why this file installs no keepalive timer: the
 *      scrape must hold the loop open by itself, or it has failed.
 *   2. The failure it settles with is the bank's or the environment's, never
 *      the logger's. A library that resolves a devDependency at runtime dies
 *      before reaching the network.
 *
 * A scrape reports failure by RETURNING a result, so an exception reaching
 * this file is itself a defect — `throw` therefore sets a non-zero exit code
 * and fails the gate rather than counting as "it settled".
 *
 * No bank is contacted. The credentials are obvious dummies. Two scenarios run:
 *
 *   leumi-503       a synthetic 503 stops the native Leumi flow at its first request.
 *   pepper-graphql  a synthetic warm token skips the login, then the packed library
 *                   resolves its registered GraphQL queries, sends them, and maps the
 *                   synthetic responses into a typed result. That proves the query
 *                   registry and the response mapping survive packing, which the 503
 *                   scenario cannot: it fails before either runs.
 *
 * Every synthetic handler replaces `fetch` outright and never calls the original, so
 * a request it does not recognise fails closed instead of reaching a network.
 */

/** Printed only when the scrape produced an outcome the caller can act on. */
const SETTLED_MARKER = 'SETTLED';
const PRIME_URL = 'https://hb2.bankleumi.co.il/H/Login.html';

/** Obvious dummies — this program must never authenticate against anything. */
const DUMMY_CREDENTIALS = {
  username: 'not-a-real-user',
  password: 'not-a-real-password',
};

/**
 * Replacement `fetch` for the Leumi scenario: accepts only the prime URL.
 * @param {string | URL | Request} input - The request target.
 * @returns {Promise<Response>} A synthetic 503.
 */
function offlineFetch(input) {
  const url = input instanceof Request ? input.url : String(input);
  if (url !== PRIME_URL) throw new Error('Unexpected consumer prime URL');
  console.log('OFFLINE_REQUEST');
  return Promise.resolve(new Response(null, { status: 503 }));
}

/**
 * Print the outcome in a form the shell gate can assert on.
 * @param {string} label - Outcome kind.
 * @param {string} detail - Message or serialised result.
 * @returns {void}
 */
function report(label, detail) {
  console.log(`${SETTLED_MARKER} ${label} ${detail}`);
}

const GRAPHQL_URL = 'https://fe-sec.pepper.co.il/graphql';

/**
 * Warm-start token with an expiry far in the future. Freshness is read locally, never
 * verified, so a token that looks fresh takes the warm path and no login request is
 * made. It is assembled at runtime and carries no key material.
 */
const WARM_TOKEN = [
  Buffer.from('{"alg":"none"}').toString('base64url'),
  Buffer.from('{"exp":4102444800}').toString('base64url'),
  'synthetic',
].join('.');

const GRAPHQL_CREDENTIALS = {
  phoneNumber: '972000000000',
  password: 'not-a-real-password',
  otpLongTermToken: WARM_TOKEN,
};

const ACCOUNT_ID = 'acct-syn-001';

/**
 * Synthetic GraphQL data per operation, keyed by the operation name in the query text.
 * Values are distinct on purpose: the mapping falls back when a field is absent
 * (`accountNumber` to the account id, `date` to `effectiveDate`, a missing balance to 0),
 * so identical values would let a dropped selection go unnoticed.
 */
const GRAPHQL_DATA = {
  UserDataV2: {
    userDataV2: {
      getUserDataV2: {
        customerAndAccounts: [
          {
            customerId: 'cust-syn-001',
            accounts: [{ accountId: ACCOUNT_ID, accountNumber: '40286139' }],
          },
        ],
      },
    },
  },
  fetchAccountBalance: { accounts: { balance: { currentBalance: 2850.6 } } },
  Transactions: {
    accounts: {
      oshTransactionsNew: {
        totalCount: 2,
        transactions: [
          {
            transactionId: 'txn-1',
            transactionAmount: -12.5,
            bookingDate: '2026-03-10T00:00:00Z',
            effectiveDate: '2026-03-11T00:00:00Z',
            currency: 'ILS',
            description: 'Synthetic coffee',
          },
        ],
        pendingTransactions: [
          {
            transactionId: 'txn-2',
            transactionAmount: -5,
            bookingDate: '2026-03-15T00:00:00Z',
            effectiveDate: '2026-03-16T00:00:00Z',
            currency: 'USD',
            description: 'Synthetic pending',
            liquidityStatus: 'pending',
          },
        ],
      },
    },
  },
};

/**
 * Read what a `fetch` call asked for, whatever form it took.
 * @param {string | URL | Request} input - The request target.
 * @param {RequestInit | undefined} init - Request options.
 * @returns {Promise<{url: string, method: string, authorization: string, body: string}>} The request.
 */
async function describeRequest(input, init) {
  const isRequest = input instanceof Request;
  const headers = new Headers(init?.headers ?? (isRequest ? input.headers : undefined));
  const sentBody = typeof init?.body === 'string' ? init.body : '';
  return {
    url: isRequest ? input.url : String(input),
    method: init?.method ?? (isRequest ? input.method : 'GET'),
    authorization: headers.get('authorization') ?? '',
    body: sentBody || (isRequest ? await input.clone().text() : ''),
  };
}

/**
 * Split a query into names, braces, parentheses and any other punctuation.
 * @param {string} query - The query text.
 * @returns {string[]} The tokens, in order, without whitespace or commas.
 */
function tokenize(query) {
  return query.match(/[A-Za-z_]\w*|[{}()]|[^\s,{}()A-Za-z_]/g) ?? [];
}

/**
 * Index just past the parenthesis that closes the one opening at `start`.
 * @param {string[]} tokens - The tokens.
 * @param {number} start - Index of the opening parenthesis.
 * @returns {number} The index after the matching close, or -1 when unbalanced.
 */
function afterParens(tokens, start) {
  let depth = 0;
  for (let i = start; i < tokens.length; i += 1) {
    if (tokens[i] === '(') depth += 1;
    if (tokens[i] === ')') depth -= 1;
    if (depth === 0) return i + 1;
  }
  return -1;
}

/**
 * Read one field and, when it has one, its nested selection.
 * @param {string[]} tokens - The tokens.
 * @param {number} at - Index of the field name.
 * @returns {{name: string, tree: object | true, next: number} | false} The field, or false
 * when the syntax is not one the registered queries use.
 */
function readField(tokens, at) {
  if (!/^[A-Za-z_]\w*$/.test(tokens[at] ?? '')) return false;
  const next = tokens[at + 1] === '(' ? afterParens(tokens, at + 1) : at + 1;
  if (next < 0) return false;
  if (tokens[next] !== '{') return { name: tokens[at], tree: true, next };
  const nested = readSet(tokens, next + 1);
  return nested === false ? false : { name: tokens[at], tree: nested.tree, next: nested.next };
}

/**
 * Read the fields of a selection set up to its closing brace.
 * @param {string[]} tokens - The tokens.
 * @param {number} from - Index just after the opening brace.
 * @returns {{tree: object, next: number} | false} The selection, or false when unsupported.
 */
function readSet(tokens, from) {
  const tree = {};
  let at = from;
  while (tokens[at] !== '}') {
    const field = readField(tokens, at);
    if (field === false || Object.hasOwn(tree, field.name)) return false;
    tree[field.name] = field.tree;
    at = field.next;
  }
  return { tree, next: at + 1 };
}

/**
 * The selection a query asks for, as a tree of field names. Only what the registered
 * queries use is understood: nested fields, arguments and a variable list. Aliases,
 * fragments and directives are not, so a query using them is rejected rather than guessed at.
 * @param {string} query - The query text.
 * @returns {object | false} The selection tree, or false when the query is not understood.
 */
function selectionOf(query) {
  const tokens = tokenize(query);
  const open = tokens[2] === '(' ? afterParens(tokens, 2) : 2;
  if (tokens[0] !== 'query' || open < 0 || tokens[open] !== '{') return false;
  const set = readSet(tokens, open + 1);
  return set !== false && set.next === tokens.length ? set.tree : false;
}

/**
 * Answer a selection the way a GraphQL server does: only the fields it names.
 * @param {unknown} value - The full synthetic value.
 * @param {object | true} tree - The selection for that value.
 * @returns {unknown} The value reduced to the selection, or undefined when it cannot be.
 */
function project(value, tree) {
  if (Array.isArray(value)) return value.map(item => project(item, tree));
  const isObject = value !== null && typeof value === 'object';
  if (tree === true) return isObject ? undefined : value;
  if (!isObject) return undefined;
  const kept = Object.entries(tree)
    .filter(([name]) => Object.hasOwn(value, name))
    .map(([name, subtree]) => [name, project(value[name], subtree)]);
  return Object.fromEntries(kept.filter(([, projected]) => projected !== undefined));
}

/** Operations that must carry the account id the first response supplied. */
const ACCOUNT_SCOPED = new Set(['fetchAccountBalance', 'Transactions']);

/**
 * Parse a request body, tolerating anything that is not a JSON object.
 * @param {string} body - The request body.
 * @returns {{query?: unknown, variables?: {accountId?: unknown}}} The parsed object, or {}.
 */
function parseBody(body) {
  try {
    const parsed = JSON.parse(body);
    return parsed !== null && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

/**
 * The registered operation a query names, or '' when it names none.
 * @param {unknown} query - The `query` field of a request body.
 * @returns {string} The operation name.
 */
function operationOf(query) {
  const found = /query\s+(\w+)/.exec(typeof query === 'string' ? query : '');
  return found !== null && Object.hasOwn(GRAPHQL_DATA, found[1]) ? found[1] : '';
}

/**
 * A URL reduced to origin and path, so a rejected request can be named without
 * echoing a query string or fragment that might carry a secret.
 * @param {string} url - The requested URL.
 * @returns {string} Origin and path, or a fixed label when it does not parse.
 */
function safeUrl(url) {
  try {
    const parsed = new URL(url);
    return `${parsed.origin}${parsed.pathname}`;
  } catch {
    return '(unparsable url)';
  }
}

/**
 * Why a request is not the one expected, or '' when it is. Names only the part that
 * differed, never a value taken from the request.
 * @param {{url: string, method: string, authorization: string, body: string}} request - The request.
 * @returns {string} The reason.
 */
function rejectionOf(request) {
  if (request.url !== GRAPHQL_URL) return `url ${safeUrl(request.url)}`;
  if (request.method !== 'POST') return `method ${request.method}`;
  if (request.authorization !== WARM_TOKEN) return 'authorization';
  const { query, variables } = parseBody(request.body);
  const operation = operationOf(query);
  if (operation === '') return 'operation';
  if (selectionOf(query) === false) return `selection ${operation}`;
  const isScoped = ACCOUNT_SCOPED.has(operation);
  if (isScoped && variables?.accountId !== ACCOUNT_ID) return `variables ${operation}`;
  return '';
}

/**
 * Build the Pepper scenario's `fetch`: serves the registered operations and rejects
 * everything else without delegating to any other `fetch`.
 * @param {{operations: Set<string>, unexpected: string[]}} state - What the run observed.
 * @returns {(input: string | URL | Request, init?: RequestInit) => Promise<Response>} The replacement.
 */
function makeGraphqlFetch(state) {
  return async function graphqlFetch(input, init) {
    const request = await describeRequest(input, init);
    const reason = rejectionOf(request);
    if (reason !== '') {
      state.unexpected.push(reason);
      throw new Error('Unexpected consumer GraphQL request');
    }
    const { query } = parseBody(request.body);
    const operation = operationOf(query);
    state.operations.add(operation);
    const data = project(GRAPHQL_DATA[operation], selectionOf(query));
    const headers = { 'content-type': 'application/json' };
    return new Response(JSON.stringify({ data }), { status: 200, headers });
  };
}

/**
 * One transaction field across both rows, joined, so each posted and pending row
 * has to carry its own value for the comparison to hold.
 * @param {object} result - What `scrape` returned.
 * @param {string} field - The transaction field.
 * @returns {string} The values, first row first.
 */
function acrossRows(result, field) {
  return result.accounts[0].txns.map(txn => String(txn[field])).join('|');
}

/** The result fields the synthetic responses must map into, with their expected values. */
const RESULT_CHECKS = [
  ['success', r => r.success === true],
  ['one account', r => Array.isArray(r.accounts) && r.accounts.length === 1],
  ['account number', r => r.accounts[0].accountNumber === '40286139'],
  ['balance', r => r.accounts[0].balance === 2850.6],
  ['two transactions', r => r.accounts[0].txns.length === 2],
  ['transaction identifiers', r => acrossRows(r, 'identifier') === 'txn-1|txn-2'],
  ['transaction amounts', r => acrossRows(r, 'chargedAmount') === '-12.5|-5'],
  ['transaction dates', r => acrossRows(r, 'date') === '2026-03-10T00:00:00Z|2026-03-15T00:00:00Z'],
  ['transaction currencies', r => acrossRows(r, 'originalCurrency') === 'ILS|USD'],
  [
    'transaction descriptions',
    r => acrossRows(r, 'description') === 'Synthetic coffee|Synthetic pending',
  ],
];

/**
 * Check the result against the typed shape the synthetic data must produce.
 * @param {object} result - What `scrape` returned.
 * @returns {string} 'ok', or `mismatch: <first failing check>`.
 */
function verdictOf(result) {
  for (const [name, check] of RESULT_CHECKS) {
    try {
      if (!check(result)) return `mismatch: ${name}`;
    } catch {
      return `mismatch: ${name}`;
    }
  }
  return 'ok';
}

/**
 * Print what the shell gate asserts on after the Pepper scenario.
 * @param {{operations: Set<string>, unexpected: string[]}} state - What the run observed.
 * @param {object} result - What `scrape` returned.
 * @returns {void}
 */
function reportGraphql(state, result) {
  console.log(`GRAPHQL_OPERATIONS ${[...state.operations].sort().join(',')}`);
  console.log(
    `GRAPHQL_UNEXPECTED ${[String(state.unexpected.length), ...state.unexpected].join(' ')}`,
  );
  console.log(`GRAPHQL_VERDICT ${verdictOf(result)}`);
}

/**
 * The scenarios the smoke can run, selected by the first command-line argument. Each names
 * the company, the credentials, how to build its `fetch`, and what to report afterwards.
 */
const SCENARIOS = {
  'leumi-503': {
    companyKey: 'Leumi',
    credentials: DUMMY_CREDENTIALS,
    makeState: () => ({}),
    makeFetch: () => offlineFetch,
    reportExtra: () => {},
  },
  'pepper-graphql': {
    companyKey: 'Pepper',
    credentials: GRAPHQL_CREDENTIALS,
    makeState: () => ({ operations: new Set(), unexpected: [] }),
    makeFetch: makeGraphqlFetch,
    reportExtra: reportGraphql,
  },
};

const DEFAULT_SCENARIO = 'leumi-503';

function createConsumerScraper({ createScraper, CompanyTypes }, scenario) {
  return createScraper({
    companyId: CompanyTypes[scenario.companyKey],
    startDate: new Date('2026-01-01'),
  });
}

/**
 * Run one scenario exactly as a consumer would, then report its outcome.
 * @param {object} exports - The package's exports.
 * @param {string} [name] - Scenario name; defaults to the Leumi 503 scenario.
 * @returns {Promise<void>}
 */
async function runScrape(exports, name = DEFAULT_SCENARIO) {
  const scenario = SCENARIOS[name];
  if (scenario === undefined) {
    report('throw', `Unknown consumer smoke scenario ${name}`);
    process.exitCode = 1;
    return;
  }
  const originalFetch = globalThis.fetch;
  const state = scenario.makeState();
  globalThis.fetch = scenario.makeFetch(state);
  try {
    const result = await createConsumerScraper(exports, scenario).scrape(scenario.credentials);
    report('result', JSON.stringify(result));
    scenario.reportExtra(state, result);
  } catch (error) {
    report('throw', error && error.message ? error.message : String(error));
    process.exitCode = 1;
  } finally {
    globalThis.fetch = originalFetch;
  }
}

module.exports = { runScrape };
if (require.main === module) {
  runScrape(require('@sergienko4/israeli-bank-scrapers'), process.argv[2]);
}
