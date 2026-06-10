/**
 * MAX — Mode B SIMULATOR integration test (Phase 11).
 *
 * <p>Drives the {@link installSimulator} state machine against the
 * committed MAX manifest.json. For each phase in the canonical chain
 * (INIT → HOME → PRE_LOGIN → LOGIN → AUTH_DISCOVERY →
 * ACCOUNT_RESOLVE → DASHBOARD → SCRAPE → TERMINATE) we fire a scripted
 * request shaped like the one the production scraper would issue and
 * assert:
 * <ul>
 *   <li>the simulator fulfils with the captured fixture body,</li>
 *   <li>the response status + content-type match the manifest contract,</li>
 *   <li>currentPhase advances to transition.advanceTo after the call,</li>
 *   <li>the final state reaches TERMINATE with zero fatal escapes.</li>
 * </ul>
 *
 * <p>MAX is username + password only — `MaxPipeline.ts` declares no
 * OTP leg, so the canonical chain skips OTP_TRIGGER / OTP_FILL
 * phases (same shape as AMEX). This deterministic Mode B suite proves
 * the per-bank manifest is well-formed and the simulator can drive
 * MAX's full chain end-to-end without touching the real bank.
 *
 * <p>MAX-distinct from AMEX / Isracard / Hapoalim / Discount Mode B:
 * scripted URLs target `www.max.co.il` (the harvested
 * `apiUrl=https://www.max.co.il/api` config root, NOT the Backbase
 * `/ocp/statuspage/...` family). The SCRAPE→TERMINATE pattern uses
 * `/api/registered/transactionDetails/getTransactionsAndGraphs`, which
 * matches `PIPELINE_WELL_KNOWN_API.transactions` at
 * `ScrapeWK.ts:35` (`/TransactionsAndGraphs/i`) — the canonical MAX
 * list endpoint per the upstream legacy scraper, and explicitly NOT a
 * singular `getTransactionDetailsActions` or
 * `transactionDetails/getDapapRegistrationPopup` (per the
 * `ScrapeWK.ts:38-44` plural-vs-singular MAX-specific false-pick trap
 * comment that caused 0-txn scrapes pre-fix). The legacy
 * `ProxyRequestHandler.ashx?reqName=*` query-string family is
 * intentionally NOT exercised — Pipeline `ScrapeWK.ts:78-85` drops
 * `.ashx` URLs as `unsupported`. The `/ocp/statuspage/` widget family
 * is also avoided (it is rejected from transaction widget selection by
 * `ScrapeWK.ts:65-77`) — MAX is not a Backbase deployment, so this is
 * naturally satisfied.
 *
 * <p>Response envelope shape: synthetic, follows the upstream legacy
 * MAX scraper convention (`{result, isSuccess, returnCode, error}`).
 * No branch-local production network capture is available for MAX
 * (`C:/tmp/runs/pipeline/max` is empty as of commit `23f4750c`). Once
 * the operator harvests real MAX captures, this manifest + responses
 * should be re-validated against the captured envelope shape.
 *
 * <p>The SCRIPT[] array below INTENTIONALLY duplicates the URL +
 * method contract declared in `manifest.json`. This is cross-validation
 * by design — the manifest is the SIMULATOR fixture contract; SCRIPT[]
 * is an independent assertion of what the production scraper would
 * issue. Deriving SCRIPT[] from the manifest at runtime would make the
 * test circular (manifest matches manifest, can no longer catch
 * manifest drift). This duplication pattern is consistent across all
 * 5 Mode B tests (Hapoalim, Discount, Isracard, AMEX, MAX) and was
 * explicitly accepted as deferred f4 in PR #331 cycle-4.
 */

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import type { Page, Request, Route } from 'playwright-core';

import ScraperError from '../../../../../Scrapers/Base/ScraperError.js';
import { installSimulator } from '../../../../Integration/Mirror/MirrorSimulator.js';

const BANK_ID = 'max';
const ABORT_COUNTER_INIT = 0;
const FULFILL_BUMP = 1;

/** Captured fulfill payload for assertions. */
interface IFulfillCapture {
  readonly status: number;
  readonly headers: Record<string, string>;
  readonly body: Buffer;
}

/** Counter slot tracking abort calls without using a primitive. */
interface IAbortCounter {
  count: number;
}

/** Route stub bundle exposing fulfill capture + abort counter. */
interface IRouteStub {
  readonly route: Route;
  readonly fulfilled: IFulfillCapture[];
  readonly aborts: IAbortCounter;
}

/** Args the simulator's route handler accepts. */
type RouteHandler = (route: Route, req: Request) => Promise<unknown>;

/** Mutable slot used to capture the installed route handler. */
interface IHandlerSlot {
  fn: RouteHandler | undefined;
}

/** Spec used to build a Request stub. */
interface IRequestSpec {
  readonly url: string;
  readonly method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  readonly resourceType: string;
  readonly postBody?: string;
}

/** Options shape passed to a Playwright Route.fulfill(). */
interface IFulfillOpts {
  readonly status?: number;
  readonly headers?: Record<string, string>;
  readonly body?: Buffer;
}

/** Bundle exposing the page stub + an invoker for the captured handler. */
interface IRouteCapture {
  readonly page: Page;
  readonly invoke: (route: Route, req: Request) => Promise<unknown>;
}

/** Single scripted transition step the test fires at the simulator. */
interface IScriptedStep {
  readonly url: string;
  readonly method: 'GET' | 'POST';
  readonly resourceType: 'document' | 'fetch' | 'xhr';
  readonly expectedStatus: number;
  readonly expectedContentType: string;
  readonly expectedPhaseAfter: string;
}

/** Bundle for {@link assertScriptedStep} keeping the 3-param ceiling. */
interface IStepAssertArgs {
  readonly step: IScriptedStep;
  readonly invoke: IRouteCapture['invoke'];
  readonly snapshotPhase: () => string;
}

const HERE_URL = fileURLToPath(import.meta.url);
const HERE = dirname(HERE_URL);
const REPO_ROOT = join(HERE, '..', '..', '..', '..', '..', '..');
const FIXTURES_ROOT = join(REPO_ROOT, 'src', 'Tests', 'Integration', 'fixtures', 'banks');
const MANIFEST_PATH = join(FIXTURES_ROOT, BANK_ID, 'manifest.json');

/** Scripted production-shaped requests covering every MAX transition. */
const SCRIPT: readonly IScriptedStep[] = [
  {
    url: 'https://www.max.co.il/',
    method: 'GET',
    resourceType: 'document',
    expectedStatus: 200,
    expectedContentType: 'text/html; charset=utf-8',
    expectedPhaseAfter: 'HOME',
  },
  {
    url: 'https://www.max.co.il/login',
    method: 'GET',
    resourceType: 'document',
    expectedStatus: 200,
    expectedContentType: 'text/html; charset=utf-8',
    expectedPhaseAfter: 'PRE_LOGIN',
  },
  {
    url: 'https://www.max.co.il/api/login/login',
    method: 'POST',
    resourceType: 'fetch',
    expectedStatus: 200,
    expectedContentType: 'application/json',
    expectedPhaseAfter: 'LOGIN',
  },
  {
    url: 'https://www.max.co.il/api/configuration/getConfiguration',
    method: 'GET',
    resourceType: 'fetch',
    expectedStatus: 200,
    expectedContentType: 'application/json',
    expectedPhaseAfter: 'AUTH_DISCOVERY',
  },
  {
    url: 'https://www.max.co.il/homepage/',
    method: 'GET',
    resourceType: 'document',
    expectedStatus: 200,
    expectedContentType: 'text/html; charset=utf-8',
    expectedPhaseAfter: 'ACCOUNT_RESOLVE',
  },
  {
    url: 'https://www.max.co.il/homepage/personal',
    method: 'GET',
    resourceType: 'document',
    expectedStatus: 200,
    expectedContentType: 'text/html; charset=utf-8',
    expectedPhaseAfter: 'DASHBOARD',
  },
  {
    url: 'https://www.max.co.il/api/contents/getCategories',
    method: 'POST',
    resourceType: 'fetch',
    expectedStatus: 200,
    expectedContentType: 'application/json',
    expectedPhaseAfter: 'SCRAPE',
  },
  {
    url: 'https://www.max.co.il/api/registered/transactionDetails/getTransactionsAndGraphs',
    method: 'POST',
    resourceType: 'fetch',
    expectedStatus: 200,
    expectedContentType: 'application/json',
    expectedPhaseAfter: 'TERMINATE',
  },
];

/** Class-based Request stub exposing the 5 methods the simulator reads. */
class RequestStub {
  /**
   * Construct a stub from a spec.
   * @param spec - URL, method, resource type, optional post body.
   */
  constructor(private readonly spec: IRequestSpec) {}

  /**
   * Return the request URL.
   * @returns Absolute URL string.
   */
  public url(): string {
    return this.spec.url;
  }

  /**
   * Return the HTTP method.
   * @returns Upper-case method verb.
   */
  public method(): string {
    return this.spec.method;
  }

  /**
   * Return the Playwright resource type.
   * @returns Resource-type string.
   */
  public resourceType(): string {
    return this.spec.resourceType;
  }

  /**
   * Return the POST body (empty for GETs).
   * @returns Body string or empty string.
   */
  public postData(): string {
    return this.spec.postBody ?? '';
  }

  /**
   * Return request headers (simulator tolerates an empty map).
   * @returns Single-entry header map keyed on the stub method to keep this-binding valid.
   */
  public headers(): Record<string, string> {
    const seed: Record<string, string> = {};
    seed['x-stub-method'] = this.spec.method;
    return seed;
  }
}

/**
 * Record a fulfill payload onto the capture array.
 * @param fulfilled - Capture array.
 * @param opts - Fulfill options from the simulator handler.
 * @returns Number of recorded fulfills after this push.
 */
function recordFulfill(fulfilled: IFulfillCapture[], opts: IFulfillOpts): number {
  const empty = Buffer.alloc(0);
  fulfilled.push({
    status: opts.status ?? 0,
    headers: opts.headers ?? {},
    body: opts.body ?? empty,
  });
  return fulfilled.length;
}

/**
 * Inner fulfill arrow: record one payload and resolve to capture length.
 * @param fulfilled - Capture array.
 * @param opts - Fulfill options.
 * @returns Promise of capture length after push.
 */
function fulfillAndCount(fulfilled: IFulfillCapture[], opts: IFulfillOpts): Promise<number> {
  const len = recordFulfill(fulfilled, opts);
  return Promise.resolve(len);
}

/**
 * Build the fulfill callback for a Route stub.
 * @param fulfilled - Array to record each fulfill call.
 * @returns Arrow recording the call payload and resolving to the new length.
 */
function makeFulfillFn(fulfilled: IFulfillCapture[]): (opts: IFulfillOpts) => Promise<number> {
  return (opts: IFulfillOpts): Promise<number> => fulfillAndCount(fulfilled, opts);
}

/**
 * Inner abort arrow: bump counter and resolve to new count.
 * @param counter - Abort counter slot.
 * @returns Promise of new count.
 */
function abortAndCount(counter: IAbortCounter): Promise<number> {
  counter.count += FULFILL_BUMP;
  return Promise.resolve(counter.count);
}

/**
 * Build the abort callback for a Route stub.
 * @param counter - Counter object bumped on each abort call.
 * @returns Arrow resolving to the new abort count.
 */
function makeAbortFn(counter: IAbortCounter): () => Promise<number> {
  return (): Promise<number> => abortAndCount(counter);
}

/**
 * Build a Route stub recording fulfill + abort calls.
 * @returns Stub exposing the route handle + capture ledgers.
 */
function makeRoute(): IRouteStub {
  const fulfilled: IFulfillCapture[] = [];
  const aborts: IAbortCounter = { count: ABORT_COUNTER_INIT };
  const stub = { fulfill: makeFulfillFn(fulfilled), abort: makeAbortFn(aborts) };
  return { route: stub as unknown as Route, fulfilled, aborts };
}

/**
 * Inner: store the handler the simulator installs.
 * @param slot - Handler slot to mutate.
 * @param handler - Route handler the simulator registers.
 * @returns Promise resolving to true once captured.
 */
function storeHandler(slot: IHandlerSlot, handler: RouteHandler): Promise<boolean> {
  slot.fn = handler;
  return Promise.resolve(true);
}

/**
 * Build the Page route callback that captures the installed handler.
 * @param slot - Handler slot the simulator's page.route() stores into.
 * @returns Route callback closure.
 */
function makeRouteCb(slot: IHandlerSlot): (_p: string, handler: RouteHandler) => Promise<boolean> {
  return (_p: string, handler: RouteHandler): Promise<boolean> => storeHandler(slot, handler);
}

/**
 * Inner: dispatch the captured route handler.
 * @param slot - Handler slot to read.
 * @param r - Route stub.
 * @param q - Request stub.
 * @returns Promise resolving when the handler completes.
 */
function dispatchHandler(slot: IHandlerSlot, r: Route, q: Request): Promise<unknown> {
  const cb = slot.fn;
  if (cb === undefined) throw new ScraperError('route handler not yet captured');
  return cb(r, q);
}

/**
 * Build the invoke helper that dispatches the captured route handler.
 * @param slot - Handler slot populated by {@link makeRouteCb}.
 * @returns Invoke function delegating to the captured handler.
 */
function makeInvoker(slot: IHandlerSlot): (r: Route, q: Request) => Promise<unknown> {
  return (r: Route, q: Request): Promise<unknown> => dispatchHandler(slot, r, q);
}

/**
 * Page-stub unroute callback (simulator calls it on dispose).
 * @returns Promise resolving to true.
 */
function noopUnroute(): Promise<boolean> {
  return Promise.resolve(true);
}

/**
 * Build a Page stub capturing the simulator's route handler.
 * @returns Capture exposing the page stub + handler invoker.
 */
function makePageCapture(): IRouteCapture {
  const slot: IHandlerSlot = { fn: undefined };
  const route = makeRouteCb(slot);
  const page = { route, unroute: noopUnroute } as unknown as Page;
  return { page, invoke: makeInvoker(slot) };
}

/**
 * Assert one fulfill capture matches the expected status + content-type
 * and contains body bytes from the manifest's fixture file.
 * @param capture - Captured fulfill payload.
 * @param step - Scripted step's expectations.
 * @returns Body byte length asserted.
 */
function assertFulfilled(capture: IFulfillCapture, step: IScriptedStep): number {
  expect(capture.status).toBe(step.expectedStatus);
  expect(capture.headers['content-type']).toBe(step.expectedContentType);
  expect(capture.body.length).toBeGreaterThan(0);
  return capture.body.length;
}

/**
 * Verify that the per-bank manifest.json file exists on disk before
 * loading the simulator (gives a clear error if fixtures are missing).
 * @returns Manifest content length in bytes.
 */
function verifyManifestPresent(): number {
  const raw = readFileSync(MANIFEST_PATH, 'utf8');
  if (raw.length === 0) throw new ScraperError(`empty manifest at ${MANIFEST_PATH}`);
  return raw.length;
}

/**
 * Build a single Request stub for one scripted step.
 * @param step - Scripted step bundle.
 * @returns Request stub.
 */
function buildScriptedRequest(step: IScriptedStep): Request {
  const stub = new RequestStub({
    url: step.url,
    method: step.method,
    resourceType: step.resourceType,
  });
  return stub as unknown as Request;
}

/**
 * Assert exact route-capture counters and return the observed fulfill count.
 * @param route - Captured route stub after a scripted step has invoked it.
 * @returns The fulfill count (always {@link FULFILL_BUMP} on a passing assertion).
 */
function assertRouteCounts(route: IRouteStub): number {
  expect(route.fulfilled.length).toBe(FULFILL_BUMP);
  expect(route.aborts.count).toBe(ABORT_COUNTER_INIT);
  return route.fulfilled.length;
}

/**
 * Fire one scripted step at the simulator and assert phase advance.
 * @param args - Step + invoke + snapshot reader.
 * @returns Promise of the body byte length asserted.
 */
async function assertScriptedStep(args: IStepAssertArgs): Promise<number> {
  const route = makeRoute();
  const req = buildScriptedRequest(args.step);
  await args.invoke(route.route, req);
  assertRouteCounts(route);
  const bytes = assertFulfilled(route.fulfilled[0], args.step);
  const currentPhase = args.snapshotPhase();
  expect(currentPhase).toBe(args.step.expectedPhaseAfter);
  return bytes;
}

/** Bundle passed to chainStep keeping the 3-param ceiling. */
interface IChainArgs {
  readonly invoke: IRouteCapture['invoke'];
  readonly snapshotPhase: () => string;
}

/**
 * Fire next step then bump the running count.
 * @param step - Next scripted step.
 * @param args - Chain args (invoke + snapshotPhase).
 * @param count - Accumulated assertion count.
 * @returns Promise of new count.
 */
async function fireAndBump(step: IScriptedStep, args: IChainArgs, count: number): Promise<number> {
  await assertScriptedStep({ step, invoke: args.invoke, snapshotPhase: args.snapshotPhase });
  return count + FULFILL_BUMP;
}

/**
 * Reducer running each scripted step sequentially via Promise chain.
 * @param prior - Promise of accumulated assertion count.
 * @param step - Next scripted step to fire.
 * @param args - Invoke + snapshot reader bundle.
 * @returns Promise of incremented assertion count.
 */
function chainStep(prior: Promise<number>, step: IScriptedStep, args: IChainArgs): Promise<number> {
  return prior.then((count: number): Promise<number> => fireAndBump(step, args, count));
}

/**
 * Reducer factory: builds an arrow chaining one scripted step's promise.
 * @param args - Chain args bundle (invoke + snapshotPhase).
 * @returns Reducer arrow.
 */
function makeReducer(
  args: IChainArgs,
): (prior: Promise<number>, step: IScriptedStep) => Promise<number> {
  return (prior: Promise<number>, step: IScriptedStep): Promise<number> =>
    chainStep(prior, step, args);
}

/**
 * Walk the scripted chain through the simulator sequentially without
 * await-in-loop (uses a Promise reduce chain).
 * @param capture - Page capture (provides invoke).
 * @param snapshotPhase - Current-phase reader.
 * @returns Promise of total assertion count.
 */
function runFullScript(capture: IRouteCapture, snapshotPhase: () => string): Promise<number> {
  const seed = Promise.resolve(0);
  const args: IChainArgs = { invoke: capture.invoke, snapshotPhase };
  const reducer = makeReducer(args);
  return SCRIPT.reduce(reducer, seed);
}

/** Bundle returned by {@link setupSimulator}. */
interface ISimContext {
  readonly capture: IRouteCapture;
  readonly handle: Awaited<ReturnType<typeof installSimulator>>;
}

/** Result of the scripted execution phase. */
interface IRunResult {
  readonly fired: number;
  readonly snapshot: ReturnType<ISimContext['handle']['snapshot']>;
}

/**
 * Wire up the simulator + page capture for the scripted walk.
 * @returns Bundle holding the capture and simulator handle.
 */
async function setupSimulator(): Promise<ISimContext> {
  verifyManifestPresent();
  const capture = makePageCapture();
  const handle = await installSimulator({
    page: capture.page,
    bankId: BANK_ID,
    fixturesRoot: FIXTURES_ROOT,
  });
  return { capture, handle };
}

/**
 * Walk every scripted step through the simulator and snapshot final state.
 * @param ctx - Simulator context from {@link setupSimulator}.
 * @returns Fire count + final snapshot.
 */
async function runScriptedWalk(ctx: ISimContext): Promise<IRunResult> {
  /**
   * Read the simulator's current phase from the snapshot.
   * @returns Current phase name.
   */
  const phaseReader = (): string => ctx.handle.snapshot().currentPhase;
  const fired = await runFullScript(ctx.capture, phaseReader);
  return { fired, snapshot: ctx.handle.snapshot() };
}

/**
 * Assert the simulator drained the script and reached TERMINATE clean.
 * Returns the asserted fire count to satisfy the `no-restricted-syntax`
 * ARCHITECTURE rule that forbids `void` returns; callers may ignore it.
 * @param result - Output of {@link runScriptedWalk}.
 * @returns Number of scripted transitions that fired.
 */
function assertCleanTerminate(result: IRunResult): number {
  expect(result.fired).toBe(SCRIPT.length);
  expect(result.snapshot.transitionsFired).toBe(SCRIPT.length);
  expect(result.snapshot.fatalEscapes.length).toBe(0);
  return result.fired;
}

describe('Max Mode B — SIMULATOR state-machine drive (Phase 11)', () => {
  it('walks INIT → HOME → ... → TERMINATE through the captured manifest', async () => {
    const ctx = await setupSimulator();
    try {
      const result = await runScriptedWalk(ctx);
      assertCleanTerminate(result);
    } finally {
      await ctx.handle.dispose();
    }
  });
});
