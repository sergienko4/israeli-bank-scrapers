/**
 * SyntheticFetchMockKit — shared machinery for the per-bank synthetic
 * fetch mocks consumed by `ApiDirectFlow.e2e-mocked.test.ts`. Banks
 * supply a single named `dispatch(url, init, tally)` function plus
 * optional extra counters; the kit handles Response shaping,
 * globalThis.fetch swap, tally tracking, and the Camoufox
 * fake-page-eval toggle.
 *
 * Rule #18: kit emits only synthetic shapes; no real PII surfaces.
 * Rule #11: no bank-specific names or URL constants live here.
 */

import { setFakePageEvalMode } from '../../Mocks/CamoufoxJsMock.js';

/** Inclusive lower bound of the HTTP 2xx success range. */
const MIN_OK_STATUS = 200;

/** Exclusive upper bound of the HTTP 2xx success range. */
const MAX_OK_STATUS = 300;

/** Empty Set-Cookie list reused across all synthetic responses. */
const NO_SET_COOKIES: readonly string[] = Object.freeze([]);

/** Minimal Headers slice consumed by NativeFetchStrategy.emitSetCookies. */
interface IHeadersLike {
  readonly getSetCookie: () => readonly string[];
}

/** Minimal Response shape the project's fetch callers consume. */
export interface IResponseLike {
  readonly ok: boolean;
  readonly status: number;
  readonly text: () => Promise<string>;
  readonly headers: IHeadersLike;
}

/** Base tally fields every bank reports. */
export interface IMockTallyBase {
  identity: number;
  graphql: number;
}

/** Per-bank extension to the tally (e.g. pinDigitsObserved). */
export type MockTallyExtra = Record<string, number>;

/** Mutable tally seen by dispatch — base + per-bank extras. */
export type IMockTally = IMockTallyBase & MockTallyExtra;

/** Snapshot of the call counts returned by IMockHandle.callCounts. */
export type IMockCallCounts = Readonly<IMockTally>;

/** Mock handle returned by every installer. */
export interface IMockHandle {
  readonly dispose: () => boolean;
  readonly callCounts: () => IMockCallCounts;
}

/** Args bundle handed to every bank's dispatch fn. */
export interface IDispatchArgs {
  readonly url: string;
  readonly init?: RequestInit;
  readonly tally: IMockTally;
}

/** Bank-supplied dispatch signature — receives URL + init + mutable tally. */
export type IMockDispatch = (args: IDispatchArgs) => IResponseLike;

/**
 * Returns the empty Set-Cookie list shared by every synthetic response.
 * @returns Frozen empty array.
 */
function noopCookies(): readonly string[] {
  return NO_SET_COOKIES;
}

/**
 * Build a Response-like with an arbitrary status + body string.
 * @param status - HTTP status code.
 * @param bodyText - Raw body text returned by text().
 * @returns Response-like.
 */
export function buildResponse(status: number, bodyText: string): IResponseLike {
  const isOkStatus = status >= MIN_OK_STATUS && status < MAX_OK_STATUS;
  /**
   * Closure returning the captured body text.
   * @returns Promise of body text.
   */
  function textFn(): Promise<string> {
    return Promise.resolve(bodyText);
  }
  const headers: IHeadersLike = { getSetCookie: noopCookies };
  return { ok: isOkStatus, status, text: textFn, headers };
}

/**
 * Wrap a JSON-serialisable payload as a 200-OK Response-like.
 * @param payload - JSON-serialisable record.
 * @returns Response-like carrying the JSON text.
 */
export function jsonOk(payload: Record<string, unknown>): IResponseLike {
  const bodyText = JSON.stringify(payload);
  return buildResponse(200, bodyText);
}

/**
 * Build a 404 Response-like carrying a canned error message — used by
 * banks as the default "no route matched" fall-through.
 * @param message - Human-readable reason.
 * @returns 404 Response-like.
 */
export function notFound(message: string): IResponseLike {
  const bodyText = JSON.stringify({ message });
  return buildResponse(404, bodyText);
}

/** Args bundle for {@link installSyntheticFetch} — keeps params ≤3. */
export interface IInstallArgs {
  readonly dispatch: IMockDispatch;
  /** Initial extra counters (e.g. `{ pinDigitsObserved: 0 }`). */
  readonly extraCounters?: MockTallyExtra;
}

/**
 * Resolve a fetch input (string | Request | URL) to its URL string form.
 * @param input - First argument passed to globalThis.fetch.
 * @returns URL as a string.
 */
function toUrlString(input: RequestInfo | URL): string {
  if (typeof input === 'string') return input;
  if (input instanceof URL) return input.toString();
  return input.url;
}

/** Internal bundle held by makeMockFetch's closure. */
interface IMockFetchDeps {
  readonly tally: IMockTally;
  readonly dispatch: IMockDispatch;
}

/**
 * Build the synthetic fetch closure bound to a tally + dispatch fn.
 * @param deps - Tally + dispatch bundle.
 * @returns Function with the globalThis.fetch signature.
 */
function makeMockFetch(deps: IMockFetchDeps): typeof globalThis.fetch {
  /**
   * Mock fetch — synchronous dispatch wrapped in a resolved Promise.
   * @param input - URL or Request.
   * @param init - Request init.
   * @returns Response-like Promise.
   */
  async function mockFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
    await Promise.resolve();
    const url = toUrlString(input);
    const resp = deps.dispatch({ url, init, tally: deps.tally });
    return resp as unknown as Response;
  }
  return mockFetch;
}

/**
 * Restore the original fetch + reset the Camoufox fake-page-eval mode.
 * @param previousFetch - The original globalThis.fetch implementation.
 * @returns True once restored.
 */
function makeDispose(previousFetch: typeof globalThis.fetch): () => boolean {
  /**
   * Bound dispose closure.
   * @returns True once restored.
   */
  function dispose(): boolean {
    globalThis.fetch = previousFetch;
    setFakePageEvalMode(false);
    return true;
  }
  return dispose;
}

/**
 * Build the call-counts snapshot accessor bound to a live tally.
 * @param tally - Live mutable tally captured by the route handlers.
 * @returns Snapshot accessor.
 */
function makeCallCounts(tally: IMockTally): () => IMockCallCounts {
  /**
   * Bound snapshot accessor — returns a frozen copy of the current tally.
   * @returns Tally snapshot.
   */
  function callCounts(): IMockCallCounts {
    return { ...tally };
  }
  return callCounts;
}

/**
 * Install the synthetic fetch mock + toggle the Camoufox fake-page-eval
 * mode. Returns a handle that restores the original fetch and exposes
 * the live tally snapshot.
 * @param args - Dispatch fn + optional extra counters.
 * @returns Mock handle.
 */
export function installSyntheticFetch(args: IInstallArgs): IMockHandle {
  const previousFetch = globalThis.fetch;
  const tally: IMockTally = { identity: 0, graphql: 0, ...args.extraCounters };
  const mockFetch = makeMockFetch({ tally, dispatch: args.dispatch });
  (globalThis as unknown as { fetch: typeof globalThis.fetch }).fetch = mockFetch;
  setFakePageEvalMode(true);
  return { dispose: makeDispose(previousFetch), callCounts: makeCallCounts(tally) };
}
