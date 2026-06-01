/**
 * Navigation request-lifecycle observer — companion to
 * {@link "./NavigationDiagnostics.js" attachFailedRequestCollector}
 * that captures requests still IN-FLIGHT at the moment `page.goto`
 * times out. Where the failed-request collector only sees Playwright
 * `requestfailed` events, this observer also listens to `request`,
 * `response`, and `requestfinished` so the snapshot can distinguish
 * "request never sent" (no entries) from "request sent, server never
 * responded" (entries with state `started`) from "response started
 * but body never finished" (state `response-received`).
 *
 * <p>The previous symptom we couldn't diagnose was the
 * `category: 'timeout'`, `failedRequests: []`, `finalUrl: about:blank`
 * fingerprint. That alone could mean (a) the browser never issued any
 * sub-request, (b) it sent one and is waiting on the TCP/TLS
 * handshake, or (c) it got headers but the response body is hung.
 * The in-flight snapshot tells the operator which one happened.
 *
 * <p>State names are deliberately conservative — `'started'` does NOT
 * prove bytes were sent on the wire. Playwright's `request` event
 * fires when the browser creates a {@link Request} object, which may
 * be before the actual socket write. The rubber-duck review flagged
 * overclaiming on state names; this module uses the minimal honest
 * vocabulary.
 */

import type { Page, Request, Response } from 'playwright-core';

/**
 * State of a request observed by the lifecycle listener.
 *
 * <p>`'started'` — Playwright fired `request` (browser created the
 * Request object; bytes may or may not have left the socket yet).
 *
 * <p>`'response-received'` — Playwright fired `response` (server
 * replied with headers; body may still be streaming).
 *
 * <p>Terminal events (`requestfinished` / `requestfailed`) remove the
 * entry from the in-flight map, so they don't need a state value.
 */
export type RequestLifecycleState = 'started' | 'response-received';

/** Single request still in-flight when the snapshot was taken. */
export interface INavInFlightRequest {
  readonly url: string;
  readonly method: string;
  readonly resourceType: string;
  readonly state: RequestLifecycleState;
  readonly startedMsAgo: number;
}

/** Snapshot of in-flight requests + cap-truncation metadata. */
export interface INavInFlightSnapshot {
  readonly inFlightRequests: readonly INavInFlightRequest[];
  readonly inFlightRequestCount: number;
  readonly inFlightRequestsTruncated: boolean;
}

/** Handle returned by {@link attachRequestLifecycleObserver}. */
export interface IRequestLifecycleObserver {
  readonly snapshot: () => INavInFlightSnapshot;
  readonly detach: () => boolean;
}

/**
 * Maximum number of in-flight requests kept in the snapshot. Banks
 * load many subresources before nav-commit; capping prevents giant
 * log envelopes from filling CI artefact storage. Oldest-first
 * ordering preserves the requests most likely to be load-bearing
 * (the initial document request is started first).
 */
const MAX_IN_FLIGHT_REQUESTS = 25;

/** Internal tracking entry; mutable `state` lets handlers patch it. */
interface IRequestEntry {
  readonly startedAtMs: number;
  state: RequestLifecycleState;
}

/** Bundle of Playwright event handlers (kept together for attach/detach). */
interface ILifecycleHandlers {
  readonly onRequest: (req: Request) => boolean;
  readonly onResponse: (resp: Response) => boolean;
  readonly onRequestFinished: (req: Request) => boolean;
  readonly onRequestFailed: (req: Request) => boolean;
}

/**
 * Build the `request` handler that records a new in-flight entry
 * keyed on the Request object itself (Playwright passes the same
 * Request instance through every lifecycle event).
 *
 * @param tracking - Mutable map keyed by Request.
 * @returns Handler returning `true` to satisfy the no-void rule.
 */
function makeOnRequest(tracking: Map<Request, IRequestEntry>): (req: Request) => boolean {
  return (req: Request): boolean => {
    const entry: IRequestEntry = { startedAtMs: Date.now(), state: 'started' };
    tracking.set(req, entry);
    return true;
  };
}

/**
 * Build the `response` handler that transitions the entry to
 * `'response-received'` when the server responds. Safe-no-op when
 * the entry is missing (request finished/failed concurrently).
 *
 * @param tracking - Mutable map keyed by Request.
 * @returns Handler returning `true` to satisfy the no-void rule.
 */
function makeOnResponse(tracking: Map<Request, IRequestEntry>): (resp: Response) => boolean {
  return (resp: Response): boolean => {
    const req = resp.request();
    const entry = tracking.get(req);
    if (entry) entry.state = 'response-received';
    return true;
  };
}

/**
 * Build the terminal-event handler used for BOTH `requestfinished`
 * and `requestfailed`. Both events mark the request as no longer
 * in-flight, so the entry is dropped from the tracking map.
 *
 * @param tracking - Mutable map keyed by Request.
 * @returns Handler returning `true` to satisfy the no-void rule.
 */
function makeOnTerminal(tracking: Map<Request, IRequestEntry>): (req: Request) => boolean {
  return (req: Request): boolean => {
    tracking.delete(req);
    return true;
  };
}

/**
 * Build the four Playwright event handlers that mutate the tracking
 * map. Extracted so {@link attachRequestLifecycleObserver} stays
 * under the 10-line cap and the same handler instances are passed
 * to both `page.on` and the detach `page.off` calls.
 *
 * @param tracking - Mutable map of in-flight requests.
 * @returns Bundle of handlers wired against the tracking map.
 */
function makeLifecycleHandlers(tracking: Map<Request, IRequestEntry>): ILifecycleHandlers {
  const onTerminal = makeOnTerminal(tracking);
  return {
    onRequest: makeOnRequest(tracking),
    onResponse: makeOnResponse(tracking),
    onRequestFinished: onTerminal,
    onRequestFailed: onTerminal,
  };
}

/**
 * Subscribe the four lifecycle handlers to the page in a single
 * batched call. Split out so {@link attachRequestLifecycleObserver}
 * stays under the line cap.
 *
 * @param page - Playwright page to observe.
 * @param handlers - Bundle of handlers built by {@link makeLifecycleHandlers}.
 * @returns Always `true` (no-void rule).
 */
function attachLifecycleHandlers(page: Page, handlers: ILifecycleHandlers): boolean {
  page.on('request', handlers.onRequest);
  page.on('response', handlers.onResponse);
  page.on('requestfinished', handlers.onRequestFinished);
  page.on('requestfailed', handlers.onRequestFailed);
  return true;
}

/**
 * Build the disposer that removes every recorded handler from the
 * page. Returns `true` to satisfy the no-void rule.
 *
 * @param page - Playwright page the handlers were registered on.
 * @param handlers - Bundle of handlers to remove.
 * @returns Function returning `true` after every `page.off` completes.
 */
function makeLifecycleDetachFn(page: Page, handlers: ILifecycleHandlers): () => boolean {
  return (): boolean => {
    page.off('request', handlers.onRequest);
    page.off('response', handlers.onResponse);
    page.off('requestfinished', handlers.onRequestFinished);
    page.off('requestfailed', handlers.onRequestFailed);
    return true;
  };
}

/** Bundle of inputs to {@link projectInFlightRequest} (`max-params: 3`). */
interface IProjectInput {
  readonly req: Request;
  readonly entry: IRequestEntry;
  readonly nowMs: number;
}

/**
 * Project a single tracking entry into the public
 * {@link INavInFlightRequest} shape used in the snapshot envelope.
 *
 * @param projection - Bundle of Request + entry + reference time.
 * @returns Public in-flight row.
 */
function projectInFlightRequest(projection: IProjectInput): INavInFlightRequest {
  return {
    url: projection.req.url(),
    method: projection.req.method(),
    resourceType: projection.req.resourceType(),
    state: projection.entry.state,
    startedMsAgo: projection.nowMs - projection.entry.startedAtMs,
  };
}

/**
 * Compare two tracking entries by `startedAtMs` ascending so
 * `Array.prototype.sort` produces oldest-first order. Extracted to
 * keep the snapshot factory readable.
 *
 * @param left - Left tuple yielded by `Map.entries()`.
 * @param right - Right tuple yielded by `Map.entries()`.
 * @returns Negative when left is older, positive when right is older.
 */
function compareEntriesOldestFirst(
  left: readonly [Request, IRequestEntry],
  right: readonly [Request, IRequestEntry],
): number {
  return left[1].startedAtMs - right[1].startedAtMs;
}

/**
 * Convert tracking map entries (sorted oldest-first) into the
 * public projected list. Extracted so the snapshot factory body
 * does not chain three nested method calls.
 *
 * @param sorted - Tracking entries already sorted oldest-first.
 * @param nowMs - Reference time for `startedMsAgo` computation.
 * @returns Projected in-flight rows in the same order as `sorted`.
 */
function projectAllEntries(
  sorted: readonly (readonly [Request, IRequestEntry])[],
  nowMs: number,
): INavInFlightRequest[] {
  const projections: INavInFlightRequest[] = [];
  for (const [req, entry] of sorted) {
    const projection = projectInFlightRequest({ req, entry, nowMs });
    projections.push(projection);
  }
  return projections;
}

/**
 * Build the snapshot accessor function. Pulls every entry from the
 * tracking map, sorts oldest-first, caps at {@link MAX_IN_FLIGHT_REQUESTS},
 * and reports truncation via flag + true count so downstream tooling
 * can detect dropped rows. Pure read; never mutates the map.
 *
 * @param tracking - Mutable map of in-flight requests.
 * @returns Snapshot function returning a frozen-shape envelope.
 */
function makeLifecycleSnapshotFn(
  tracking: Map<Request, IRequestEntry>,
): () => INavInFlightSnapshot {
  return (): INavInFlightSnapshot => {
    const nowMs = Date.now();
    const entriesIter = tracking.entries();
    const entries = Array.from(entriesIter);
    entries.sort(compareEntriesOldestFirst);
    const projected = projectAllEntries(entries, nowMs);
    const isTruncated = projected.length > MAX_IN_FLIGHT_REQUESTS;
    const capped = isTruncated ? projected.slice(0, MAX_IN_FLIGHT_REQUESTS) : projected;
    return {
      inFlightRequests: capped,
      inFlightRequestCount: projected.length,
      inFlightRequestsTruncated: isTruncated,
    };
  };
}

/**
 * Attach a lifecycle observer that records every request currently
 * in-flight on the page. The returned handle lets the caller take a
 * point-in-time snapshot (typically on `page.goto` failure) and
 * detach all four event listeners in a `finally` block so they don't
 * leak into the next navigation attempt.
 *
 * <p>MUST call `detach()` before the page is reused — leaving the
 * listeners attached accumulates entries across every subsequent
 * goto on the same page.
 *
 * @param page - Playwright page to observe.
 * @returns Handle exposing `snapshot()` + `detach()`.
 */
export function attachRequestLifecycleObserver(page: Page): IRequestLifecycleObserver {
  const tracking = new Map<Request, IRequestEntry>();
  const handlers = makeLifecycleHandlers(tracking);
  attachLifecycleHandlers(page, handlers);
  return {
    snapshot: makeLifecycleSnapshotFn(tracking),
    detach: makeLifecycleDetachFn(page, handlers),
  };
}
