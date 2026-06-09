/**
 * Discount — Mode B SIMULATOR integration test (Phase 11).
 *
 * <p>Drives the {@link installSimulator} state machine against the
 * committed Discount manifest.json. For each phase in the canonical
 * chain (INIT → HOME → PRE_LOGIN → LOGIN → AUTH_DISCOVERY →
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
 * <p>This is the deterministic counterpart to the live-bank E2E runs:
 * it proves Discount's per-bank manifest is well-formed and the
 * simulator can drive it end-to-end without touching the real bank.
 */

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import type { Page, Request, Route } from 'playwright-core';

import ScraperError from '../../../../../Scrapers/Base/ScraperError.js';
import { installSimulator } from '../../../../Integration/Mirror/MirrorSimulator.js';

const BANK_ID = 'discount';
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

/** Scripted production-shaped requests covering every Discount transition. */
const SCRIPT: readonly IScriptedStep[] = [
  {
    url: 'https://www.discountbank.co.il/',
    method: 'GET',
    resourceType: 'document',
    expectedStatus: 200,
    expectedContentType: 'text/html; charset=utf-8',
    expectedPhaseAfter: 'HOME',
  },
  {
    url: 'https://start.telebank.co.il/login/#/LOGIN_PAGE',
    method: 'GET',
    resourceType: 'document',
    expectedStatus: 200,
    expectedContentType: 'text/html; charset=utf-8',
    expectedPhaseAfter: 'PRE_LOGIN',
  },
  {
    url: 'https://start.telebank.co.il/Lobby/gatewayAPI/verification/getInfo',
    method: 'POST',
    resourceType: 'fetch',
    expectedStatus: 200,
    expectedContentType: 'application/json',
    expectedPhaseAfter: 'LOGIN',
  },
  {
    url: 'https://start.telebank.co.il/Lobby/gatewayAPI/loginSuccessResponse',
    method: 'GET',
    resourceType: 'fetch',
    expectedStatus: 200,
    expectedContentType: 'application/json',
    expectedPhaseAfter: 'AUTH_DISCOVERY',
  },
  {
    url: 'https://start.telebank.co.il/Titan/gatewayAPI/userAccountsData',
    method: 'GET',
    resourceType: 'fetch',
    expectedStatus: 200,
    expectedContentType: 'application/json;charset=utf-8',
    expectedPhaseAfter: 'ACCOUNT_RESOLVE',
  },
  {
    url: 'https://start.telebank.co.il/Titan/gatewayAPI/accountDetails/infoAndBalance/000000',
    method: 'GET',
    resourceType: 'fetch',
    expectedStatus: 200,
    expectedContentType: 'application/json;charset=utf-8',
    expectedPhaseAfter: 'DASHBOARD',
  },
  {
    url: 'https://start.telebank.co.il/Titan/gatewayAPI/dashboard/dashboardBalances',
    method: 'POST',
    resourceType: 'fetch',
    expectedStatus: 200,
    expectedContentType: 'application/json;charset=utf-8',
    expectedPhaseAfter: 'SCRAPE',
  },
  {
    url: 'https://start.telebank.co.il/Titan/gatewayAPI/lastTransactions/transactions/000000/forHomePage',
    method: 'GET',
    resourceType: 'fetch',
    expectedStatus: 200,
    expectedContentType: 'application/json;charset=utf-8',
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
   * @returns Empty header map keyed by the spec method to satisfy this-binding.
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
 * Fire one scripted step at the simulator and assert phase advance.
 * @param args - Step + invoke + snapshot reader.
 * @returns Promise of the body byte length asserted.
 */
async function assertScriptedStep(args: IStepAssertArgs): Promise<number> {
  const route = makeRoute();
  const req = buildScriptedRequest(args.step);
  await args.invoke(route.route, req);
  expect(route.fulfilled.length).toBe(FULFILL_BUMP);
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

describe('Discount Mode B — SIMULATOR state-machine drive (Phase 11)', () => {
  it('walks INIT → HOME → ... → TERMINATE through the captured manifest', async () => {
    verifyManifestPresent();
    const capture = makePageCapture();
    const handle = await installSimulator({
      page: capture.page,
      bankId: BANK_ID,
      fixturesRoot: FIXTURES_ROOT,
    });
    try {
      /**
       * Read the simulator's current phase from the snapshot.
       * @returns Phase name.
       */
      const phaseReader = (): string => handle.snapshot().currentPhase;
      const fired = await runFullScript(capture, phaseReader);
      expect(fired).toBe(SCRIPT.length);
      const snap = handle.snapshot();
      expect(snap.transitionsFired).toBe(SCRIPT.length);
      expect(snap.fatalEscapes.length).toBe(0);
    } finally {
      await handle.dispose();
    }
  });
});
