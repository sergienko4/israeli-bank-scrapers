/**
 * Navigation diagnostics — failure forensics for {@link InitActions} `executeNavigateToBank`.
 *
 * <p>Captures wall-clock timing, error categorisation, failed sub-requests,
 * and the final page URL when `page.goto` fails. Helps distinguish
 * CI-only failure modes (DNS / TCP / TLS issues on runner pools) from
 * app-layer blocks (WAF challenge pages, redirects, etc.) without
 * changing the {@link ScraperErrorTypes} `Generic` error contract that
 * callers depend on.
 *
 * <p>ZERO behavior change to the success path: collector attaches /
 * detaches inside a try/finally; the structured `warn` log only fires
 * on the failure path. Designed to make `Beinleumi: page.goto timeout
 * 15000ms exceeded` style CI failures actionable — operators will see
 * `category` + `failedRequests[]` + `attemptDurationMs` in the log
 * payload and know whether the next move is "retry / IP rotation"
 * (`dns` / `tcp-*`), "renew CA bundle" (`tls`), or "investigate slow
 * bank" (`timeout` with empty `failedRequests`).
 */

import type { Page, Request } from 'playwright-core';

import type { ScraperLogger } from '../../Types/Debug.js';

/** Categorised network-layer cause derived from the error message text. */
export type NavErrorCategory = 'timeout' | 'dns' | 'tcp-refused' | 'tcp-reset' | 'tls' | 'unknown';

/** Single sub-request that failed during a `goto` attempt. */
export interface INavFailedRequest {
  readonly url: string;
  readonly errorText: string;
}

/** Snapshot of network state at the moment navigation failed. */
export interface INavFailureSnapshot {
  readonly attemptDurationMs: number;
  readonly finalUrl: string;
  readonly errorName: string;
  readonly errorMessage: string;
  readonly category: NavErrorCategory;
  readonly failedRequests: readonly INavFailedRequest[];
}

/** Handle returned by {@link attachFailedRequestCollector}. Call `detach()` to remove the listener. */
export interface IFailedRequestCollector {
  readonly collected: readonly INavFailedRequest[];
  readonly detach: () => boolean;
}

/**
 * Ordered patterns mapping error-message tokens to network-layer
 * categories. Covers both Firefox/Camoufox (`NS_ERROR_*`) and Chromium
 * (`ERR_*` / `net::ERR_*`) error vocabularies — the codebase ships
 * Camoufox in production but the catalog stays bi-vendor so the
 * diagnostic survives a future engine swap.
 */
const CATEGORY_PATTERNS: readonly { pattern: RegExp; category: NavErrorCategory }[] = [
  { pattern: /\btimeout\b/i, category: 'timeout' },
  { pattern: /NS_ERROR_UNKNOWN_HOST|ERR_NAME_NOT_RESOLVED/i, category: 'dns' },
  { pattern: /NS_ERROR_CONNECTION_REFUSED|ERR_CONNECTION_REFUSED/i, category: 'tcp-refused' },
  {
    pattern:
      /NS_ERROR_CONNECTION_RESET|NS_ERROR_NET_INTERRUPT|ERR_CONNECTION_RESET|ERR_NETWORK_CHANGED/i,
    category: 'tcp-reset',
  },
  { pattern: /\b(?:SSL|TLS)\b|CERT_|ERR_CERT_|NS_ERROR_NET_INADEQUATE_SECURITY/i, category: 'tls' },
];

/**
 * Classify a navigation error message into a network-layer category.
 * First matching pattern wins; order in {@link CATEGORY_PATTERNS} is
 * load-bearing (timeout before tls because Playwright wraps TLS
 * handshake hangs as a TimeoutError too).
 *
 * @param message - Error message text from `page.goto`.
 * @returns Best-matched category, `'unknown'` when no pattern hits.
 */
export function classifyNavError(message: string): NavErrorCategory {
  const hit = CATEGORY_PATTERNS.find(({ pattern }) => pattern.test(message));
  return hit ? hit.category : 'unknown';
}

/**
 * Convert a single Playwright {@link Request} failure to a snapshot row.
 *
 * @param request - The failed request.
 * @returns Snapshot row with `url` + `errorText`.
 */
function snapshotRequest(request: Request): INavFailedRequest {
  return { url: request.url(), errorText: request.failure()?.errorText ?? 'unknown' };
}

/**
 * Attach a `page.on('requestfailed')` listener that accumulates failed
 * sub-requests for the lifetime of a `goto` attempt. MUST call
 * `detach()` in a finally block — leaving the listener attached leaks
 * to every subsequent goto on the same page.
 *
 * @param page - Playwright page to observe.
 * @returns Handle exposing the growing `collected` list and `detach`.
 */
export function attachFailedRequestCollector(page: Page): IFailedRequestCollector {
  const collected: INavFailedRequest[] = [];
  const handler = makeCollectorHandler(collected);
  page.on('requestfailed', handler);
  const detach = makeCollectorDetach(page, handler);
  return { collected, detach };
}

/**
 * Build the `requestfailed` handler that appends each failed
 * sub-request to the collector's accumulator. Extracted into its own
 * function so the inline arrow inside {@link attachFailedRequestCollector}
 * does not violate the architecture rule against nested calls (the
 * `snapshotRequest(request)` call would be nested inside `push(...)`
 * if defined inline).
 *
 * @param collected - Mutable accumulator (appended in place).
 * @returns Handler returning `true` to satisfy the no-void rule.
 */
function makeCollectorHandler(collected: INavFailedRequest[]): (request: Request) => boolean {
  return (request: Request): boolean => {
    const snapshot = snapshotRequest(request);
    collected.push(snapshot);
    return true;
  };
}

/**
 * Build the disposer that removes the recorded handler from the page.
 * Returns `true` after detaching (the architecture rule forbids `void`
 * return types).
 *
 * @param page - Playwright page the handler was registered on.
 * @param handler - Handler instance to remove.
 * @returns Function returning `true` after `page.off` completes.
 */
function makeCollectorDetach(page: Page, handler: (request: Request) => boolean): () => boolean {
  return (): boolean => {
    page.off('requestfailed', handler);
    return true;
  };
}

/**
 * Inputs to {@link buildNavFailureSnapshot}. Bundled to satisfy the
 * project's `max-params: 3` architecture rule.
 */
export interface INavFailureInput {
  readonly error: Error;
  readonly attemptDurationMs: number;
  readonly finalUrl: string;
  readonly failedRequests: readonly INavFailedRequest[];
}

/**
 * Build the failure snapshot from inputs gathered during the goto
 * attempt. Pure function — no side effects, no Playwright calls.
 *
 * @param input - Bundle of error + timing + url + failed sub-requests.
 * @returns Structured snapshot for `logger.warn` emission.
 */
export function buildNavFailureSnapshot(input: INavFailureInput): INavFailureSnapshot {
  return {
    attemptDurationMs: input.attemptDurationMs,
    finalUrl: input.finalUrl,
    errorName: input.error.name,
    errorMessage: input.error.message,
    category: classifyNavError(input.error.message),
    failedRequests: input.failedRequests,
  };
}

/**
 * Emit the failure snapshot through the pipeline logger as a single
 * `warn` event. The `event` key (`INIT-ACTION-NAV-FAILURE`) is the
 * stable grep handle for CI log triage. Returns the snapshot that was
 * emitted (echo pattern) — both for caller chaining and to satisfy the
 * project's architecture rule against exported primitive returns.
 *
 * @param logger - Pipeline logger (pino).
 * @param snapshot - The assembled snapshot.
 * @returns The same snapshot, after the `warn` call has been issued.
 */
export function logNavFailureSnapshot(
  logger: ScraperLogger,
  snapshot: INavFailureSnapshot,
): INavFailureSnapshot {
  logger.warn({ event: 'INIT-ACTION-NAV-FAILURE', ...snapshot });
  return snapshot;
}
