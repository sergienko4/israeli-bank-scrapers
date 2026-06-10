/**
 * Beinleumi — Mode B SIMULATOR integration test (Phase 11).
 *
 * <p>Drives the {@link installSimulator} state machine against the
 * committed Beinleumi manifest.json. For each phase in the canonical
 * chain (INIT → HOME → PRE_LOGIN → LOGIN → OTP_TRIGGER → OTP_FILL →
 * AUTH_DISCOVERY → ACCOUNT_RESOLVE → DASHBOARD → SCRAPE → TERMINATE)
 * we fire a scripted request shaped like the one the production scraper
 * would issue and assert:
 * <ul>
 *   <li>the simulator fulfils with the captured fixture body,</li>
 *   <li>the response status + content-type match the manifest contract,</li>
 *   <li>currentPhase advances to transition.advanceTo after the call,</li>
 *   <li>the OTP nonce-binding round-trip succeeds (FIRST Phase-11 bank),</li>
 *   <li>the final state reaches TERMINATE with zero fatal escapes.</li>
 * </ul>
 *
 * <p>Beinleumi is OTP-gated — `BeinleumiPipeline.ts` declares
 * `.withOtpTrigger().withOtpFill()` so the canonical chain INCLUDES
 * explicit OTP_TRIGGER + OTP_FILL phases. Beinleumi is the FIRST bank
 * in the Phase-11 series to exercise the simulator's
 * `integ_otp_challenge` nonce-binding contract (Hapoalim's Mode B
 * COLLAPSES OTP into a single LOGIN→AUTH_DISCOVERY transition; MAX /
 * AMEX / Isracard / VisaCal / Discount are password-only). The OTP
 * round-trip pattern below is taken verbatim from
 * {@link ../../../Integration/Mirror/MirrorSimulator.test.ts}
 * (lines 486-580): OTP_TRIGGER fulfilled response auto-gets
 * `Set-Cookie: integ_otp_challenge=<nonce>` injected by the simulator
 * (see {@link ../../../Integration/Mirror/MirrorSimulator.ts}
 * `composeResponseHeaders`); the test parses the nonce out of the
 * fulfilled response, then re-injects it as `Cookie:` header on the
 * OTP_FILL request along with `postBody = '{"code":"123456"}'`
 * matching `DEFAULT_TEST_OTP_CODE`.
 *
 * <p>Beinleumi-distinct from MAX / AMEX / Isracard / VisaCal / Hapoalim
 * Mode B: scripted URLs target `www.fibi.co.il` +
 * `online.fibi.co.il` (the harvested DUAL host shape per real
 * captures at `C:/tmp/runs/pipeline/beinleumi/05-06-2026_18204064/`).
 * The auth path family (`/api/v2/auth/key_exchange` / `/login` /
 * `/otp/send_sms` / `/otp/verify` / `/identity`) is unique to
 * Beinleumi (FIBI) and explicitly NOT the Hapoalim
 * `/ServerServices/` or MAX `/api/login/` family. The SCRAPE→TERMINATE
 * pattern uses
 * `/appsng/bff-balancetransactions/api/v1/transactions/list`, which is
 * Beinleumi's modern BFF endpoint (NOT MAX's `getTransactionsAndGraphs`
 * or VisaCal's `getCardTransactionsDetails`).
 *
 * <p>Response envelope shape: synthetic, follows real Beinleumi shapes
 * — auth phases use `{error_code, error_message, data, headers[]}`,
 * identity / accounts use `{data, Status:'OK'}`, dashboard +
 * transactions use the `bff-balancetransactions` envelopes
 * (`{returncode, errorMessage, summary | transactions[], pagingContext}`).
 *
 * <p>The SCRIPT[] array below INTENTIONALLY duplicates the URL +
 * method contract declared in `manifest.json`. This is cross-validation
 * by design — the manifest is the SIMULATOR fixture contract; SCRIPT[]
 * is an independent assertion of what the production scraper would
 * issue. Deriving SCRIPT[] from the manifest at runtime would make the
 * test circular (manifest matches manifest, can no longer catch
 * manifest drift). This duplication pattern is consistent across all
 * 6 prior Mode B tests (Hapoalim, Discount, Isracard, AMEX, MAX,
 * VisaCal) and was explicitly accepted as deferred f4 in PR #331
 * cycle-4.
 */

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import type { Page, Request, Route } from 'playwright-core';

import ScraperError from '../../../../../Scrapers/Base/ScraperError.js';
import { installSimulator } from '../../../../Integration/Mirror/MirrorSimulator.js';

const BANK_ID = 'beinleumi';
const ABORT_COUNTER_INIT = 0;
const FULFILL_BUMP = 1;
const OTP_CHALLENGE_COOKIE = 'integ_otp_challenge';
const OTP_TEST_CODE = '123456';
const OTP_POST_BODY = JSON.stringify({ code: OTP_TEST_CODE });

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
  readonly headers?: Record<string, string>;
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
  readonly isOtpFill?: true;
  readonly isOtpTrigger?: true;
}

/** Mutable carrier sharing the OTP nonce between OTP_TRIGGER and OTP_FILL steps. */
interface INonceCarrier {
  value: string;
}

/** Bundle for {@link assertScriptedStep} keeping the 3-param ceiling. */
interface IStepAssertArgs {
  readonly step: IScriptedStep;
  readonly invoke: IRouteCapture['invoke'];
  readonly snapshotPhase: () => string;
  readonly nonce: INonceCarrier;
}

const HERE_URL = fileURLToPath(import.meta.url);
const HERE = dirname(HERE_URL);
const REPO_ROOT = join(HERE, '..', '..', '..', '..', '..', '..');
const FIXTURES_ROOT = join(REPO_ROOT, 'src', 'Tests', 'Integration', 'fixtures', 'banks');
const MANIFEST_PATH = join(FIXTURES_ROOT, BANK_ID, 'manifest.json');

/**
 * Scripted production-shaped requests covering every Beinleumi
 * transition. Includes explicit OTP_TRIGGER + OTP_FILL steps for the
 * nonce-binding contract.
 */
const SCRIPT: readonly IScriptedStep[] = [
  {
    url: 'https://www.fibi.co.il/',
    method: 'GET',
    resourceType: 'document',
    expectedStatus: 200,
    expectedContentType: 'text/html; charset=utf-8',
    expectedPhaseAfter: 'HOME',
  },
  {
    url: 'https://online.fibi.co.il/login',
    method: 'GET',
    resourceType: 'document',
    expectedStatus: 200,
    expectedContentType: 'text/html; charset=utf-8',
    expectedPhaseAfter: 'PRE_LOGIN',
  },
  {
    url: 'https://online.fibi.co.il/api/v2/auth/key_exchange',
    method: 'POST',
    resourceType: 'fetch',
    expectedStatus: 200,
    expectedContentType: 'application/json; charset=utf-8',
    expectedPhaseAfter: 'LOGIN',
  },
  {
    url: 'https://online.fibi.co.il/api/v2/auth/login',
    method: 'POST',
    resourceType: 'fetch',
    expectedStatus: 200,
    expectedContentType: 'application/json; charset=utf-8',
    expectedPhaseAfter: 'OTP_TRIGGER',
  },
  {
    url: 'https://online.fibi.co.il/api/v2/auth/otp/send_sms',
    method: 'POST',
    resourceType: 'fetch',
    expectedStatus: 200,
    expectedContentType: 'application/json; charset=utf-8',
    expectedPhaseAfter: 'OTP_FILL',
    isOtpTrigger: true,
  },
  {
    url: 'https://online.fibi.co.il/api/v2/auth/otp/verify',
    method: 'POST',
    resourceType: 'fetch',
    expectedStatus: 200,
    expectedContentType: 'application/json; charset=utf-8',
    expectedPhaseAfter: 'AUTH_DISCOVERY',
    isOtpFill: true,
  },
  {
    url: 'https://online.fibi.co.il/api/v2/auth/identity',
    method: 'GET',
    resourceType: 'fetch',
    expectedStatus: 200,
    expectedContentType: 'application/json; charset=utf-8',
    expectedPhaseAfter: 'ACCOUNT_RESOLVE',
  },
  {
    url: 'https://online.fibi.co.il/api/accounts',
    method: 'GET',
    resourceType: 'fetch',
    expectedStatus: 200,
    expectedContentType: 'application/json; charset=utf-8',
    expectedPhaseAfter: 'DASHBOARD',
  },
  {
    url: 'https://online.fibi.co.il/appsng/bff-balancetransactions/api/v1/dashboard/summary',
    method: 'GET',
    resourceType: 'fetch',
    expectedStatus: 200,
    expectedContentType: 'application/json; charset=utf-8',
    expectedPhaseAfter: 'SCRAPE',
  },
  {
    url: 'https://online.fibi.co.il/appsng/bff-balancetransactions/api/v1/transactions/list',
    method: 'POST',
    resourceType: 'fetch',
    expectedStatus: 200,
    expectedContentType: 'application/json; charset=utf-8',
    expectedPhaseAfter: 'TERMINATE',
  },
];

/** Class-based Request stub exposing the 5 methods the simulator reads. */
class RequestStub {
  /**
   * Construct a stub from a spec.
   * @param spec - URL, method, resource type, optional post body + headers.
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
   * Return request headers; OTP_FILL injects the Cookie carrying the
   * `integ_otp_challenge` nonce harvested from OTP_TRIGGER.
   * @returns Header map keyed lower-case for simulator parity.
   */
  public headers(): Record<string, string> {
    const seed: Record<string, string> = {};
    seed['x-stub-method'] = this.spec.method;
    const provided = this.spec.headers ?? {};
    return { ...seed, ...provided };
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
 * Build the Cookie header map for an OTP_FILL step. Returns an empty
 * map for non-OTP_FILL steps so callers can always spread the return
 * into a header bag without undefined-check noise.
 * @param step - Scripted step bundle (may carry isOtpFill).
 * @param nonce - Carrier holding the issued nonce (mutated by trigger step).
 * @returns Header map to attach (empty when nothing to inject).
 */
function composeRequestHeaders(step: IScriptedStep, nonce: INonceCarrier): Record<string, string> {
  if (step.isOtpFill !== true) return {};
  if (nonce.value.length === 0) throw new ScraperError('OTP_FILL fired without harvested nonce');
  return { cookie: `${OTP_CHALLENGE_COOKIE}=${nonce.value}` };
}

/**
 * Build a single Request stub for one scripted step. OTP_FILL gets the
 * `{ code: '123456' }` postBody + the harvested Cookie header.
 * @param step - Scripted step bundle.
 * @param nonce - Carrier holding the harvested nonce (read on OTP_FILL).
 * @returns Request stub.
 */
function buildScriptedRequest(step: IScriptedStep, nonce: INonceCarrier): Request {
  const stub = new RequestStub({
    url: step.url,
    method: step.method,
    resourceType: step.resourceType,
    postBody: step.isOtpFill === true ? OTP_POST_BODY : undefined,
    headers: composeRequestHeaders(step, nonce),
  });
  return stub as unknown as Request;
}

/**
 * Parse the `integ_otp_challenge` nonce out of a Set-Cookie header line.
 * Defensively matches the cookie BY NAME rather than positionally so a
 * header like `foo=bar; integ_otp_challenge=<nonce>` (or comma-merged
 * multi-cookie shape Playwright sometimes returns) is handled correctly.
 * Returns empty string when no challenge cookie is present.
 * @param setCookieHeader - Raw set-cookie header value.
 * @returns Extracted nonce or empty string.
 */
function parseChallengeNonce(setCookieHeader: string): string {
  const needle = `${OTP_CHALLENGE_COOKIE}=`;
  for (const cookie of setCookieHeader.split(/,(?=[^;]+?=)/)) {
    const firstSegment = cookie.trim().split(';')[0];
    if (!firstSegment.startsWith(needle)) continue;
    return firstSegment.slice(needle.length);
  }
  return '';
}

/**
 * Read the issued OTP nonce from the fulfilled response Set-Cookie
 * header. Throws when the trigger step did not issue a challenge.
 * @param route - Captured route stub after OTP_TRIGGER fired.
 * @returns Extracted nonce string (always non-empty on success).
 */
function readTriggerNonce(route: IRouteStub): string {
  const setCookie = route.fulfilled[0]?.headers['set-cookie'] ?? '';
  const harvested = parseChallengeNonce(setCookie);
  if (harvested.length === 0) throw new ScraperError('OTP_TRIGGER did not issue nonce cookie');
  return harvested;
}

/**
 * After the OTP_TRIGGER step fires, harvest the nonce the simulator
 * injected via `Set-Cookie` and store it on the shared carrier so the
 * subsequent OTP_FILL request can echo it back.
 * @param step - Scripted step just fired.
 * @param route - Captured route stub after the fire.
 * @param nonce - Carrier to mutate on success.
 * @returns Length of the harvested nonce (0 means not harvested).
 */
function harvestNonceFromTrigger(
  step: IScriptedStep,
  route: IRouteStub,
  nonce: INonceCarrier,
): number {
  if (step.isOtpTrigger !== true) return 0;
  const harvested = readTriggerNonce(route);
  nonce.value = harvested;
  return harvested.length;
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
 * Fire one scripted step at the simulator (no assertions). Returns the
 * captured route stub so the caller can inspect fulfills + counters.
 * @param args - Step + invoke + snapshot reader + nonce carrier.
 * @returns Promise of the captured route stub.
 */
async function fireScriptedStep(args: IStepAssertArgs): Promise<IRouteStub> {
  const route = makeRoute();
  const req = buildScriptedRequest(args.step, args.nonce);
  await args.invoke(route.route, req);
  return route;
}

/**
 * Fire one scripted step at the simulator and assert phase advance.
 * Harvests the OTP nonce post-fire when the step is OTP_TRIGGER.
 * @param args - Step + invoke + snapshot reader + nonce carrier.
 * @returns Promise of the body byte length asserted.
 */
async function assertScriptedStep(args: IStepAssertArgs): Promise<number> {
  const route = await fireScriptedStep(args);
  assertRouteCounts(route);
  const bytes = assertFulfilled(route.fulfilled[0], args.step);
  const phase = args.snapshotPhase();
  expect(phase).toBe(args.step.expectedPhaseAfter);
  harvestNonceFromTrigger(args.step, route, args.nonce);
  return bytes;
}

/** Bundle passed to chainStep keeping the 3-param ceiling. */
interface IChainArgs {
  readonly invoke: IRouteCapture['invoke'];
  readonly snapshotPhase: () => string;
  readonly nonce: INonceCarrier;
}

/**
 * Fire next step then bump the running count.
 * @param step - Next scripted step.
 * @param args - Chain args (invoke + snapshotPhase + nonce).
 * @param count - Accumulated assertion count.
 * @returns Promise of new count.
 */
async function fireAndBump(step: IScriptedStep, args: IChainArgs, count: number): Promise<number> {
  await assertScriptedStep({
    step,
    invoke: args.invoke,
    snapshotPhase: args.snapshotPhase,
    nonce: args.nonce,
  });
  return count + FULFILL_BUMP;
}

/**
 * Reducer running each scripted step sequentially via Promise chain.
 * @param prior - Promise of accumulated assertion count.
 * @param step - Next scripted step to fire.
 * @param args - Invoke + snapshot reader + nonce carrier bundle.
 * @returns Promise of incremented assertion count.
 */
function chainStep(prior: Promise<number>, step: IScriptedStep, args: IChainArgs): Promise<number> {
  return prior.then((count: number): Promise<number> => fireAndBump(step, args, count));
}

/**
 * Reducer factory: builds an arrow chaining one scripted step's promise.
 * @param args - Chain args bundle (invoke + snapshotPhase + nonce).
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
 * await-in-loop (uses a Promise reduce chain). Maintains a mutable
 * nonce carrier across the chain so OTP_FILL can echo the
 * OTP_TRIGGER-issued nonce.
 * @param capture - Page capture (provides invoke).
 * @param snapshotPhase - Current-phase reader.
 * @returns Promise of total assertion count.
 */
function runFullScript(capture: IRouteCapture, snapshotPhase: () => string): Promise<number> {
  const seed = Promise.resolve(0);
  const nonce: INonceCarrier = { value: '' };
  const args: IChainArgs = { invoke: capture.invoke, snapshotPhase, nonce };
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

describe('Beinleumi Mode B — SIMULATOR state-machine drive (Phase 11)', () => {
  it('walks INIT → ... → OTP_TRIGGER → OTP_FILL → ... → TERMINATE through the captured manifest', async () => {
    const ctx = await setupSimulator();
    try {
      const result = await runScriptedWalk(ctx);
      assertCleanTerminate(result);
    } finally {
      await ctx.handle.dispose();
    }
  });
});
