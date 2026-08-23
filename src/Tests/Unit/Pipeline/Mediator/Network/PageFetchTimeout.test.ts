/**
 * Unit tests for the in-page fetch abort budget.
 *
 * `page.evaluate` accepts no `timeout` option (playwright-core types: the only
 * option is `exposeFunctions`), and `setDefaultTimeout` documents itself as
 * covering "all the methods accepting `timeout` option". So Playwright does
 * NOT bound an evaluate, and before this budget a stalled bank endpoint hung
 * the in-page fetch indefinitely.
 *
 * These tests give the fake page an `evaluate` that INVOKES the callback, so
 * the real in-page body runs in Node and the abort wiring is exercised rather
 * than mocked away. The 30 s budget itself is never waited on: the timeout
 * factory is stubbed with a controller the test aborts on demand.
 *
 * LIMIT of the bare-realm serialisability check below: it catches a
 * module-scope reference only on a path the call actually EXECUTES. A
 * reference sitting on a short-circuited branch (`args.x || MODULE_CONST`)
 * would not throw here, yet would still break in the browser once that branch
 * is taken. Verified by mutation — the `||` form passed, the unconditional
 * form failed. Keep the in-page bodies branch-free of module scope.
 */

import * as vm from 'node:vm';

import { jest } from '@jest/globals';
import type { Page } from 'playwright-core';

import {
  fetchGetWithinPage,
  fetchGetWithinPageWithHeaders,
  fetchPostWithinPage,
} from '../../../../../Scrapers/Pipeline/Mediator/Network/Fetch/index.js';
import {
  NETWORK_FETCH_PAGE_TIMEOUT_MS,
  NETWORK_FETCH_TIMEOUT_MS,
} from '../../../../../Scrapers/Pipeline/Mediator/Network/FetchConfig.js';

const REAL_FETCH = globalThis.fetch;
const REAL_TIMEOUT_FACTORY = AbortSignal.timeout.bind(AbortSignal);

/** Budgets handed to AbortSignal.timeout during the current test. */
let requestedBudgets: number[] = [];
/** Init object captured from the in-page fetch call. */
let capturedInit: RequestInit | undefined;
/** Controller backing the stubbed timeout signal, so tests abort on demand. */
let controller: AbortController;

/**
 * A page whose evaluate runs the callback in-process. Playwright would
 * serialise the body into the browser; running it here executes the same code
 * against Node's fetch and AbortSignal.
 * @returns Fake page.
 */
function createInvokingPage(): Page {
  /**
   * Invoke the in-page body directly.
   * @param fn - The serialised in-page callback.
   * @param args - Its single argument bundle.
   * @returns Whatever the in-page body returns.
   */
  const evaluate = (fn: (a: unknown) => unknown, args: unknown): unknown => fn(args);
  return { evaluate } as unknown as Page;
}

/**
 * A page whose evaluate never settles, so the Node-side deadline decides.
 *
 * The in-page abort is deliberately given a later budget than the Node timer
 * ({@link NETWORK_FETCH_PAGE_TIMEOUT_MS} > {@link NETWORK_FETCH_TIMEOUT_MS}),
 * so a page that never resolves is exactly the condition under which callers
 * observe the Node-classified `TimeoutError` — and therefore its message.
 * @returns Fake page.
 */
function createHangingPage(): Page {
  /**
   * Never settle, mimicking a request the page never completes.
   * @returns A promise that stays pending.
   */
  const evaluate = (): Promise<never> => new Promise<never>(() => undefined);
  return { evaluate } as unknown as Page;
}

/**
 * Replace the timeout factory so no test waits on the real 30 s budget.
 * @returns True once installed.
 */
function stubTimeoutFactory(): boolean {
  /**
   * Record the requested budget and hand back a controllable signal.
   * @param ms - Budget requested by production code.
   * @returns Signal the test can abort.
   */
  const factory = (ms: number): AbortSignal => {
    requestedBudgets.push(ms);
    return controller.signal;
  };
  AbortSignal.timeout = factory;
  return true;
}

/**
 * Stub fetch with a successful JSON response, capturing the init it received.
 * @param body - Response body text.
 * @returns True once installed.
 */
function stubRespondingFetch(body: string): boolean {
  /**
   * Capture init, then resolve a minimal Response.
   * @param _url - Ignored; assertions target the init.
   * @param init - Init built by the in-page body.
   * @returns Resolved mock response.
   */
  const stub = (_url: string, init: RequestInit): Promise<Response> => {
    capturedInit = init;
    /**
     * Response body text accessor.
     * @returns Resolved body string.
     */
    const text = (): Promise<string> => Promise.resolve(body);
    return Promise.resolve({ status: 200, text } as unknown as Response);
  };
  globalThis.fetch = stub as unknown as typeof fetch;
  return true;
}

/**
 * Stub fetch with a request that never resolves on its own and rejects only
 * when the abort signal fires — the browser's behaviour for an aborted fetch.
 * @returns True once installed.
 */
function stubStallingFetch(): boolean {
  /**
   * Hang until the caller-supplied signal aborts.
   * @param _url - Ignored.
   * @param init - Init built by the in-page body.
   * @returns Promise that rejects on abort.
   */
  const stub = (_url: string, init: RequestInit): Promise<Response> => {
    capturedInit = init;
    const signal = init.signal;
    expect(signal).toBeDefined();
    return new Promise<Response>((_resolve, reject) => {
      /**
       * Reject the pending fetch once the signal aborts.
       * @returns True once the rejection has been queued.
       */
      const onAbort = (): boolean => {
        const failure = new Error('TimeoutError: signal timed out');
        reject(failure);
        return true;
      };
      signal?.addEventListener('abort', onAbort, { once: true });
    });
  };
  globalThis.fetch = stub as unknown as typeof fetch;
  return true;
}

/**
 * Body accessor for a 204, which a correct in-page body never calls.
 * @returns Always rejects.
 */
function rejectBodyRead(): Promise<string> {
  return Promise.reject(new Error('read the body of a 204 response'));
}

/**
 * Stub fetch with a no-content response whose body must never be read.
 *
 * Each in-page body branches on `response.status === 204`, and until the
 * no-content realm check below, every test that reached response handling drove
 * the body-bearing arm. A module-scope reference on this one satisfied the
 * whole suite and would still have thrown on the first real no-content
 * response.
 * @returns True once installed.
 */
function stubNoContentFetch(): boolean {
  /**
   * Capture init, then resolve a 204 that rejects if its body is read.
   * @param _url - Ignored; assertions target the branch taken.
   * @param init - Init built by the in-page body.
   * @returns Resolved mock response.
   */
  const stub = (_url: string, init: RequestInit): Promise<Response> => {
    capturedInit = init;
    const response = { status: 204, text: rejectBodyRead } as unknown as Response;
    return Promise.resolve(response);
  };
  globalThis.fetch = stub as unknown as typeof fetch;
  return true;
}

beforeEach(() => {
  requestedBudgets = [];
  capturedInit = undefined;
  controller = new AbortController();
  stubTimeoutFactory();
});

afterEach(() => {
  globalThis.fetch = REAL_FETCH;
  AbortSignal.timeout = REAL_TIMEOUT_FACTORY;
});

/** A budget no production path uses, so a captured constant cannot fake it. */
const SENTINEL_BUDGET_MS = 1234;
/** Target used by every carrier below. */
const TARGET_URL = 'https://bank.co.il/api';

/**
 * A URL carrying PII in both places {@link redactUrlFull} masks: an
 * account-shaped path segment and a known-PII query key.
 *
 * A timeout message is built from the URL the caller passed, so an unredacted
 * label would put a live account number and bearer token into every log that
 * records the failure. The values below are synthetic — never copy a real
 * account number or token into a fixture.
 */
const PII_URL = 'https://bank.co.il/api/accounts/1234567890?token=sample-token';

/** Synthetic account digits that must never reach a log. */
const PII_ACCOUNT = '1234567890';

/** Synthetic token value that must never reach a log. */
const PII_TOKEN = 'sample-token';

/** Last-4 hint `redactUrlFull` leaves in place of the account segment. */
const REDACTED_ACCOUNT_HINT = '***7890';

/**
 * A page whose evaluate substitutes the budget before invoking the body.
 *
 * The plain invoking page cannot tell an argument read from a closed-over
 * constant, because both produce the same number. Rewriting the data and
 * observing the result change is what proves the body honours its argument —
 * the property real Playwright serialisation depends on.
 * @param budgetMs - Sentinel budget to substitute.
 * @returns Fake page.
 */
function createBudgetOverridingPage(budgetMs: number): Page {
  /**
   * Invoke the in-page body with the substituted budget.
   * @param fn - The serialised in-page callback.
   * @param args - Its single argument bundle.
   * @returns Whatever the in-page body returns.
   */
  const evaluate = (fn: (a: unknown) => unknown, args: unknown): unknown =>
    fn({ ...(args as object), timeoutMs: budgetMs });
  return { evaluate } as unknown as Page;
}

/**
 * Identifier shape Istanbul gives its per-file coverage counter, in the call
 * position it always appears in.
 *
 * The name is a hash of the file — it differs between machines and between CI
 * runs — so it cannot be listed literally. Requiring the trailing `(` keeps a
 * bare identifier of the same shape from being admitted, so the only thing
 * that gets a stub is something being *called* the way a counter is.
 */
const COVERAGE_COUNTER = /\bcov_[0-9a-z]+(?=\()/g;

/**
 * A stand-in for Istanbul's counter object.
 *
 * Instrumented code performs `cov_x().f[0]++`, `.s[1]++` and `.b[0][1]++`, so
 * the stub mirrors that exact shape: statement and function groups index
 * straight to a counter, while the branch group indexes to a *row* of counters
 * first. Modelling it faithfully keeps every leaf a real number.
 *
 * A single self-referential proxy is tempting and wrong: `++` on it would look
 * up `Symbol.toPrimitive`, receive the proxy rather than a function, and throw
 * `object is not a function`. Returning a primitive at the leaf also makes the
 * nested branch write safe under strict mode, where assigning through a
 * primitive would throw rather than be silently discarded.
 *
 * Values are never read back — the realm exists to prove the body resolves,
 * not to measure it.
 * @returns Callable that yields an accept-anything counter bag.
 */
function createCoverageStub(): () => unknown {
  /**
   * Accept any counter increment.
   * @returns True, so the assignment succeeds even under strict mode.
   */
  const acceptWrite = (): boolean => true;
  /**
   * Yield a real number, so `++` coerces without consulting the proxy.
   * @returns Zero.
   */
  const readSlot = (): number => 0;
  const slot = new Proxy({}, { get: readSlot, set: acceptWrite });
  /**
   * Yield a counter row, for the two-level branch form.
   * @returns The slot proxy.
   */
  const readRow = (): unknown => slot;
  const row = new Proxy({}, { get: readRow, set: acceptWrite });
  /**
   * Route `b` to a row of counters and `f`/`s` straight to a counter.
   * @param _target - Unused proxy target.
   * @param key - Counter group being read.
   * @returns Row proxy for branches, slot proxy otherwise.
   */
  const readGroup = (_target: object, key: string | symbol): unknown => (key === 'b' ? row : slot);
  const bag = new Proxy({}, { get: readGroup, set: acceptWrite });
  return (): unknown => bag;
}

/**
 * Admit the coverage counter, and nothing else, into the realm.
 *
 * Under `--coverage` the body's own source carries a reference to a module-scope
 * counter that the instrumenter injected. That reference is an artefact of the
 * harness, not a dependency of the module, so failing on it would make this test
 * report a defect that does not exist — while passing without coverage, which is
 * the worst combination.
 *
 * Only names called in this specific source AND matching the counter shape are
 * defined, so a real module-scope reference still raises a ReferenceError. A
 * provider that injects a differently-shaped name fails closed, which is the
 * right direction for a guard.
 * @param globals - Realm globals to extend.
 * @param source - The body's own source text.
 * @returns The globals, with any counter admitted.
 */
function admitCoverageCounter(
  globals: Record<string, unknown>,
  source: string,
): Record<string, unknown> {
  const names = source.match(COVERAGE_COUNTER) ?? [];
  const stub = createCoverageStub();
  for (const name of names) globals[name] = stub;
  return globals;
}

/**
 * A page whose evaluate runs the body in an isolated VM realm.
 *
 * The substituted-budget page proves the body READS its argument, but not that
 * the body is SERIALISABLE. `AbortSignal.timeout(Math.min(args.timeoutMs,
 * NETWORK_FETCH_PAGE_TIMEOUT_MS))` would satisfy the former and still break in a
 * real page, because the imported constant does not cross into the browser.
 *
 * Compiling the callback's own source inside a fresh context reproduces that
 * boundary: only the globals listed here exist, so any module-scope reference
 * the body closed over raises a ReferenceError exactly as Playwright would.
 * @returns Fake page.
 */
function createIsolatedPage(): Page {
  /**
   * Recompile the body in a bare realm, then invoke it.
   * @param fn - The serialised in-page callback.
   * @param args - Its single argument bundle.
   * @returns Whatever the in-page body returns.
   */
  const evaluate = (fn: (a: unknown) => unknown, args: unknown): unknown => {
    const source = fn.toString();
    const bare = browserGlobals();
    const globals = admitCoverageCounter(bare, source);
    const realm = vm.createContext(globals);
    const script = new vm.Script(`(${source})`);
    const compiled = script.runInContext(realm) as (a: unknown) => unknown;
    return compiled(args);
  };
  return { evaluate } as unknown as Page;
}

/**
 * The globals a page body may legitimately reference.
 *
 * Deliberately minimal — anything absent here is something the body must not
 * depend on.
 * @returns Global object for the isolated realm.
 */
function browserGlobals(): Record<string, unknown> {
  return {
    fetch: globalThis.fetch,
    AbortSignal,
    Error,
    Promise,
    JSON,
    Object,
    Math,
  };
}

/**
 * Every entry point that issues an in-page fetch.
 *
 * `fetchGetWithinPageWithHeaders` is a third in-page body, not a wrapper over
 * the plain GET, so it needs its own budget wiring and its own coverage — it is
 * the path taken whenever discovered headers exist.
 */
const CARRIERS = [
  {
    label: 'GET',
    /**
     * Issue a plain in-page GET.
     * @param page - Page under test.
     * @param url - URL to request.
     * @returns The parsed body.
     */
    run: async (page: Page, url: string = TARGET_URL): Promise<unknown> =>
      fetchGetWithinPage(page, url),
  },
  {
    label: 'GET with headers',
    /**
     * Issue an in-page GET carrying discovered headers.
     * @param page - Page under test.
     * @param url - URL to request.
     * @returns The parsed body.
     */
    run: async (page: Page, url: string = TARGET_URL): Promise<unknown> =>
      fetchGetWithinPageWithHeaders(page, url, { 'X-Discovered': 'v' }),
  },
  {
    label: 'POST',
    /**
     * Issue an in-page POST.
     * @param page - Page under test.
     * @param url - URL to request.
     * @returns The parsed body.
     */
    run: async (page: Page, url: string = TARGET_URL): Promise<unknown> =>
      fetchPostWithinPage(page, url, { data: {} }),
  },
] as const;

describe('in-page abort budget', () => {
  it.each(CARRIERS)('$label requests the same budget the native path uses', async ({ run }) => {
    stubRespondingFetch('{"ok":true}');
    const page = createInvokingPage();
    await run(page);
    expect(requestedBudgets).toEqual([NETWORK_FETCH_PAGE_TIMEOUT_MS]);
  });

  it.each(CARRIERS)('$label hands the abort signal to the in-page fetch', async ({ run }) => {
    stubRespondingFetch('{"ok":true}');
    const page = createInvokingPage();
    await run(page);
    expect(capturedInit?.signal).toBe(controller.signal);
  });

  it.each(CARRIERS)('$label surfaces an aborted request instead of hanging', async ({ run }) => {
    stubStallingFetch();
    const page = createInvokingPage();
    const pending = run(page);
    controller.abort();
    await expect(pending).rejects.toThrow('TimeoutError');
  });

  it.each(CARRIERS)('$label reads its budget from evaluate data', async ({ run }) => {
    stubRespondingFetch('{"ok":true}');
    const page = createBudgetOverridingPage(SENTINEL_BUDGET_MS);
    await run(page);
    expect(requestedBudgets).toEqual([SENTINEL_BUDGET_MS]);
  });

  it.each(CARRIERS)('$label runs in a realm with no module scope', async ({ run }) => {
    stubRespondingFetch('{"ok":true}');
    const page = createIsolatedPage();
    await run(page);
    expect(requestedBudgets).toEqual([NETWORK_FETCH_PAGE_TIMEOUT_MS]);
  });

  // The realm check above only ever drives the body-bearing arm. Resolving
  // without reading the body is the proof the no-content arm was taken, since
  // the stub rejects on read.
  it.each(CARRIERS)('$label runs its no-content arm in that realm too', async ({ run }) => {
    stubNoContentFetch();
    const page = createIsolatedPage();
    await run(page);
    expect(requestedBudgets).toEqual([NETWORK_FETCH_PAGE_TIMEOUT_MS]);
  });
});

describe('in-page POST payload', () => {
  it('keeps the captured SPA headers alongside the signal', async () => {
    stubRespondingFetch('{"ok":true}');
    const page = createInvokingPage();
    const opts = { data: {}, extraHeaders: { 'X-Captured': 'val' } };
    await fetchPostWithinPage(page, TARGET_URL, opts);
    expect(capturedInit?.headers).toMatchObject({ 'X-Captured': 'val' });
  });
});

// The success path already redacts before logging, so an unredacted timeout
// label is the asymmetry worth pinning: the failure path is precisely where a
// URL gets written out, and a bank URL carries the account in its path and the
// bearer token in its query.
describe('in-page timeout message redaction', () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  /**
   * Drive a carrier against a page that never settles until the Node deadline
   * fires, and hand back the resulting error.
   * @param run - Carrier entry point.
   * @returns The rejection the caller would observe.
   */
  async function timeoutError(run: (page: Page, url?: string) => Promise<unknown>): Promise<Error> {
    const hangingPage = createHangingPage();
    const pending = run(hangingPage, PII_URL);
    const captured = pending.then(
      (value: unknown): unknown => value,
      (error: unknown): unknown => error,
    );
    await jest.advanceTimersByTimeAsync(NETWORK_FETCH_TIMEOUT_MS);
    const settled = await captured;
    expect(settled).toBeInstanceOf(Error);
    return settled as Error;
  }

  it.each(CARRIERS)('$label masks the account and token it timed out on', async ({ run }) => {
    const error = await timeoutError(run);
    expect(error.message).not.toContain(PII_ACCOUNT);
    expect(error.message).not.toContain(PII_TOKEN);
  });

  it.each(CARRIERS)('$label still identifies the request it timed out on', async ({ run }) => {
    const error = await timeoutError(run);
    expect(error.message).toContain(REDACTED_ACCOUNT_HINT);
  });
});
