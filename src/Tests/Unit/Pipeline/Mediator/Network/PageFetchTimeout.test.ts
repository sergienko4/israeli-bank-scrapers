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
 */

import * as vm from 'node:vm';

import type { Page } from 'playwright-core';

import {
  fetchGetWithinPage,
  fetchGetWithinPageWithHeaders,
  fetchPostWithinPage,
} from '../../../../../Scrapers/Pipeline/Mediator/Network/Fetch/index.js';
import { NETWORK_FETCH_PAGE_TIMEOUT_MS } from '../../../../../Scrapers/Pipeline/Mediator/Network/FetchConfig.js';

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
 * Identifier shape Istanbul gives its per-file coverage counter.
 *
 * The name is a hash of the file, so it cannot be listed literally.
 */
const COVERAGE_COUNTER = /\bcov_[0-9a-z]+\b/g;

/**
 * A stand-in for Istanbul's counter object.
 *
 * Instrumented code performs `cov_x().f[0]++`, `.s[1]++` and `.b[0][1]++`, so
 * every lookup must yield something indexable and assignable. Values are never
 * read back — the realm exists to prove the body resolves, not to measure it.
 * @returns Callable that yields an accept-anything counter bag.
 */
function createCoverageStub(): () => unknown {
  /**
   * Yield a readable zero for any counter slot.
   * @returns Zero.
   */
  const readSlot = (): number => 0;
  /**
   * Accept any counter increment.
   * @returns True, so the assignment succeeds.
   */
  const acceptWrite = (): boolean => true;
  const leaf = new Proxy({}, { get: readSlot, set: acceptWrite });
  /**
   * Yield the same leaf for `f`, `s` and `b` alike.
   * @returns The shared leaf.
   */
  const readGroup = (): unknown => leaf;
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
 * Only names present in this source AND matching the counter shape are defined,
 * so a real module-scope reference still raises a ReferenceError.
 * @param globals - Realm globals to extend.
 * @param source - The body's own source text.
 * @returns How many counter names were admitted.
 */
function admitCoverageCounter(globals: Record<string, unknown>, source: string): number {
  const names = source.match(COVERAGE_COUNTER) ?? [];
  const stub = createCoverageStub();
  for (const name of names) globals[name] = stub;
  return names.length;
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
    const globals = browserGlobals();
    const source = fn.toString();
    admitCoverageCounter(globals, source);
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
     * @returns The parsed body.
     */
    run: async (page: Page): Promise<unknown> => fetchGetWithinPage(page, TARGET_URL),
  },
  {
    label: 'GET with headers',
    /**
     * Issue an in-page GET carrying discovered headers.
     * @param page - Page under test.
     * @returns The parsed body.
     */
    run: async (page: Page): Promise<unknown> =>
      fetchGetWithinPageWithHeaders(page, TARGET_URL, { 'X-Discovered': 'v' }),
  },
  {
    label: 'POST',
    /**
     * Issue an in-page POST.
     * @param page - Page under test.
     * @returns The parsed body.
     */
    run: async (page: Page): Promise<unknown> =>
      fetchPostWithinPage(page, TARGET_URL, { data: {} }),
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
