/**
 * SimulatorScriptDrive — shared Mode B harness. Fires a scripted,
 * production-shaped request sequence at {@link installSimulator} through
 * Page / Route / Request stubs and reports, per request, what the
 * simulator fulfilled and which phase it advanced to.
 *
 * <p>Returns observations only (no `expect`), so each bank's
 * `*.modeB.test.ts` owns its assertions. Introduced with Mizrahi so a new
 * bank reuses one copy of the stub plumbing instead of adding another.
 */

import type { Page, Request, Route } from 'playwright-core';

import ScraperError from '../../../Scrapers/Base/ScraperError.js';
import {
  installSimulator,
  type ISimulatorHandle,
  type ISimulatorSnapshot,
} from './MirrorSimulator.js';

/** One production-shaped request fired at the simulator. */
interface IScriptedRequest {
  readonly url: string;
  readonly method: 'GET' | 'POST';
  readonly resourceType: 'document' | 'fetch' | 'xhr';
  readonly postBody?: string;
}

/** What the simulator did for one scripted request. */
interface IStepObservation {
  readonly fulfillCount: number;
  readonly status: number;
  readonly contentType: string;
  readonly body: string;
  readonly phaseAfter: string;
}

/** Arguments for {@link runSimulatorScript}. */
interface ISimulatorScriptArgs {
  readonly bankId: string;
  readonly fixturesRoot: string;
  readonly script: readonly IScriptedRequest[];
}

/** Whole-script result: per-request observations plus the final snapshot. */
interface ISimulatorScriptResult {
  readonly steps: readonly IStepObservation[];
  readonly final: ISimulatorSnapshot;
}

/** Route handler shape the simulator registers through `page.route`. */
type RouteHandler = (route: Route, req: Request) => Promise<unknown>;

/** Mutable slot receiving the handler the simulator installs. */
interface IHandlerSlot {
  fn: RouteHandler | undefined;
}

/** Options the simulator passes to `route.fulfill`. */
interface IFulfillOpts {
  readonly status?: number;
  readonly headers?: Record<string, string>;
  readonly body?: Buffer;
}

/** Installed simulator plus the captured route handler. */
interface IDrive {
  readonly slot: IHandlerSlot;
  readonly handle: ISimulatorHandle;
}

/** Request stub exposing the methods the simulator reads. */
class ScriptedRequestStub {
  /**
   * Wrap one scripted request.
   * @param spec - URL, method and resource type.
   */
  constructor(private readonly spec: IScriptedRequest) {}

  /**
   * Request URL.
   * @returns Absolute URL.
   */
  public url(): string {
    return this.spec.url;
  }

  /**
   * HTTP method.
   * @returns Upper-case verb.
   */
  public method(): string {
    return this.spec.method;
  }

  /**
   * Playwright resource type.
   * @returns Resource-type string.
   */
  public resourceType(): string {
    return this.spec.resourceType;
  }

  /**
   * POST body, empty when the script supplies none.
   * @returns Body string.
   */
  public postData(): string {
    return this.spec.postBody ?? '';
  }

  /**
   * Scripted requests carry no predicate headers.
   * @returns Header map with only a stub marker.
   */
  public headers(): Record<string, string> {
    return { 'x-stub-method': this.spec.method };
  }
}

/**
 * Async acknowledgement for stub calls that record nothing (abort, unroute).
 * @returns True.
 */
function acknowledge(): Promise<boolean> {
  return Promise.resolve(true);
}

/**
 * Record one fulfill on the ledger.
 * @param fulfills - Ledger to append to.
 * @param opts - Fulfill options.
 * @returns Ledger length.
 */
function recordFulfill(fulfills: IFulfillOpts[], opts: IFulfillOpts): Promise<number> {
  const length = fulfills.push(opts);
  return Promise.resolve(length);
}

/**
 * Build the fulfill callback for a route stub.
 * @param fulfills - Ledger the callback appends to.
 * @returns Callback recording one fulfill.
 */
function makeFulfillFn(fulfills: IFulfillOpts[]): (opts: IFulfillOpts) => Promise<number> {
  return (opts: IFulfillOpts): Promise<number> => recordFulfill(fulfills, opts);
}

/**
 * Build a route stub that records every fulfill call; aborts are counted by
 * the simulator snapshot, not here.
 * @param fulfills - Ledger the stub appends to.
 * @returns Route stub.
 */
function makeRoute(fulfills: IFulfillOpts[]): Route {
  const stub = { fulfill: makeFulfillFn(fulfills), abort: acknowledge };
  return stub as unknown as Route;
}

/**
 * Store the handler the simulator installs.
 * @param slot - Slot receiving the handler.
 * @param handler - Simulator route handler.
 * @returns True.
 */
function storeHandler(slot: IHandlerSlot, handler: RouteHandler): Promise<boolean> {
  slot.fn = handler;
  return Promise.resolve(true);
}

/**
 * Build the `page.route` callback that captures the simulator's handler.
 * @param slot - Slot receiving the handler.
 * @returns Route-registration callback.
 */
function makeRouteCb(
  slot: IHandlerSlot,
): (_pattern: string, handler: RouteHandler) => Promise<boolean> {
  return (_pattern: string, handler: RouteHandler): Promise<boolean> => storeHandler(slot, handler);
}

/**
 * Build a page stub whose `route` call stores the simulator's handler.
 * @param slot - Slot receiving the handler.
 * @returns Page stub.
 */
function makePage(slot: IHandlerSlot): Page {
  const stub = { route: makeRouteCb(slot), unroute: acknowledge };
  return stub as unknown as Page;
}

/**
 * Summarise the fulfill ledger for one request.
 * @param fulfills - Fulfill calls recorded for the request.
 * @param phaseAfter - Simulator phase after the request.
 * @returns Step observation.
 */
function observe(fulfills: readonly IFulfillOpts[], phaseAfter: string): IStepObservation {
  const first = fulfills.at(0);
  const fulfillCount = fulfills.length;
  const status = first?.status ?? 0;
  const contentType = first?.headers?.['content-type'] ?? '';
  const body = first?.body?.toString('utf8') ?? '';
  return { fulfillCount, status, contentType, body, phaseAfter };
}

/**
 * Fire one scripted request through the captured handler.
 * @param drive - Installed simulator and handler slot.
 * @param spec - Scripted request.
 * @returns What the simulator did.
 */
async function fireStep(drive: IDrive, spec: IScriptedRequest): Promise<IStepObservation> {
  const handler = drive.slot.fn;
  if (handler === undefined) throw new ScraperError('simulator route handler not captured');
  const fulfills: IFulfillOpts[] = [];
  const request = new ScriptedRequestStub(spec) as unknown as Request;
  const route = makeRoute(fulfills);
  await handler(route, request);
  const { currentPhase } = drive.handle.snapshot();
  return observe(fulfills, currentPhase);
}

/**
 * Append one step's observation after the prior steps settle.
 * @param drive - Installed simulator and handler slot.
 * @param prior - Observations so far.
 * @param spec - Next scripted request.
 * @returns Observations including this step.
 */
async function appendStep(
  drive: IDrive,
  prior: Promise<readonly IStepObservation[]>,
  spec: IScriptedRequest,
): Promise<readonly IStepObservation[]> {
  const done = await prior;
  const next = await fireStep(drive, spec);
  return [...done, next];
}

/**
 * Fire every scripted request in order (promise chain, no await-in-loop).
 * @param drive - Installed simulator and handler slot.
 * @param script - Ordered scripted requests.
 * @returns One observation per request.
 */
function fireAll(
  drive: IDrive,
  script: readonly IScriptedRequest[],
): Promise<readonly IStepObservation[]> {
  const seed: Promise<readonly IStepObservation[]> = Promise.resolve([]);
  return script.reduce(
    (prior, spec): Promise<readonly IStepObservation[]> => appendStep(drive, prior, spec),
    seed,
  );
}

/**
 * Install the simulator for a bank behind a handler-capturing page stub.
 * @param args - Bank id and fixtures root.
 * @returns Installed simulator plus the captured handler slot.
 */
async function installDrive(args: ISimulatorScriptArgs): Promise<IDrive> {
  const slot: IHandlerSlot = { fn: undefined };
  const page = makePage(slot);
  const { bankId, fixturesRoot } = args;
  const handle = await installSimulator({ page, bankId, fixturesRoot });
  return { slot, handle };
}

/**
 * Install the simulator for a bank, fire the script, and dispose.
 * @param args - Bank id, fixtures root and script.
 * @returns Per-request observations and the final snapshot.
 */
async function runSimulatorScript(args: ISimulatorScriptArgs): Promise<ISimulatorScriptResult> {
  const drive = await installDrive(args);
  try {
    const steps = await fireAll(drive, args.script);
    return { steps, final: drive.handle.snapshot() };
  } finally {
    await drive.handle.dispose();
  }
}

export type { IScriptedRequest, ISimulatorScriptResult, IStepObservation };
export { runSimulatorScript };
