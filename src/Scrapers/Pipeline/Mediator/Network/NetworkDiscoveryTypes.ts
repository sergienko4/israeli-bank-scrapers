/**
 * Types for network discovery — discovered endpoints and discovery interface.
 */

import type { IFetchOpts } from '../../Strategy/Fetch/FetchStrategy.js';
import type { IAuthFailureWatcher } from './AuthFailureWatcher.js';

/** A discovered API endpoint — captured from browser network traffic. */
interface IDiscoveredEndpoint {
  /** Full URL including query params. */
  readonly url: string;
  /** HTTP method (GET or POST). */
  readonly method: 'GET' | 'POST' | 'PUT';
  /** POST body if applicable. */
  readonly postData: string;
  /** Parsed JSON response body. */
  readonly responseBody: unknown;
  /** Response content type. */
  readonly contentType: string;
  /** Request headers sent by page JS (for auth token, origin, site ID). */
  readonly requestHeaders: Record<string, string>;
  /** Response headers from server (for CORS, content-type, cookies). */
  readonly responseHeaders: Record<string, string>;
  /** Capture timestamp (ms since epoch). */
  readonly timestamp: number;
  /**
   * Sequential capture index — same `dumpCounter` value used as the
   * filename prefix `NNNN-METHOD-stub.json` under the run's `network/`
   * folder. Lets a structured log line referencing this endpoint be
   * deterministically joined to its on-disk capture file via
   * `runId` + `captureIndex`. Optional: undefined when the endpoint
   * was synthesised without a dump (frozen replay, tests).
   */
  readonly captureIndex?: number;
  /**
   * Phase 7f — set by `discoverShapeAware` so DASHBOARD's resolver can
   * record which tier produced the pick. Ordered from cleanest to
   * loosest match: `postWithShape` (real txns in body) >
   * `replayablePost` (POST template, body may be empty) >
   * `shapePassing` (shape gate passed but tier indeterminate) >
   * `preClickFallback` (post-click pool yielded nothing; pre-click
   * capture matched). Optional: undefined when synthesised in tests.
   */
  readonly pickerTier?:
    | 'postWithShape'
    | 'replayablePost'
    | 'shapePassing'
    | 'preClickFallback'
    | 'none';
  /**
   * Phase 7f — true when the picker fell back to the pre-click pool
   * because the post-click pool had no `WK_API.transactions` match.
   * Visacal-class banks where the real TRX URL fires at login-FINAL.
   * Optional: undefined when not set.
   */
  readonly capturedPreClick?: boolean;
}

/** Network discovery interface — captures and queries API traffic. */
interface INetworkDiscovery {
  /**
   * Lifecycle gate — controls whether the live response listener stores
   * incoming captures. The pipeline interceptor flips this off during
   * INIT/HOME/LOGIN/OTP-* and on once the auth boundary is crossed,
   * so the post-auth discovery pool is never polluted by login or
   * SMS-trigger traffic. Idempotent; safe to call repeatedly. Frozen
   * networks accept the call as a no-op so callers can stay agnostic.
   * @param active - True to record captures, false to drop them.
   * @returns True after the state is applied.
   */
  setCollectionActive(active: boolean): true;

  /**
   * Mark the moment DASHBOARD.ACTION dispatched its navigation click.
   * Used by `getPreNavCaptures` / `getPostNavCaptures` to split the
   * captured stream into the pre-nav (login + dashboard-landing
   * widget) bucket and the post-nav (full-history) bucket. Bank-
   * agnostic — every bank's dashboard click executor calls this once.
   * @param timestampMs - `Date.now()` at the moment of click.
   * @returns True after the timestamp is stored.
   */
  markDashboardClickAt(timestampMs: number): true;

  /**
   * Read the dashboard-click timestamp set by `markDashboardClickAt`.
   * Returns `false` when the click hasn't been dispatched yet, or
   * when the discovery instance is a frozen replay that wasn't
   * primed with a click time.
   * @returns Click timestamp in ms-since-epoch, or false.
   */
  getDashboardClickAt(): number | false;

  /**
   * All captures whose `timestamp` is strictly less than the
   * dashboard-click moment — login + dashboard-landing traffic.
   * Returns the empty array when no click has been marked, or all
   * captures when the click marker is in the future.
   * @returns Captures captured before the dashboard nav click.
   */
  getPreNavCaptures(): readonly IDiscoveredEndpoint[];

  /**
   * Captures whose `timestamp` is at or after the dashboard-click
   * moment — the full-history traffic the SPA fires once the user
   * navigates to the all-transactions view. When that subset has
   * NO transaction-pattern URL match (banks like Hapoalim that fire
   * full-history on login already), this returns the FULL captured
   * array instead, so the consumer always sees a complete pool.
   * The fallback is the soft-copy contract: SCRAPE.PRE never has to
   * ask "is post-nav empty?" — DASHBOARD.FINAL guarantees it isn't.
   * @returns Captures captured after the dashboard nav click, with
   *   pre-nav fallback when no post-nav txn matches exist.
   */
  getPostNavCaptures(): readonly IDiscoveredEndpoint[];

  /**
   * Find all captured endpoints matching a URL pattern.
   * @param pattern - Regex to match against endpoint URLs.
   * @returns Matching endpoints in capture order.
   */
  findEndpoints(pattern: RegExp): readonly IDiscoveredEndpoint[];

  /**
   * Get the common services base URL from captured traffic.
   * Extracts the URL path before query params from the most common pattern.
   * @returns Services URL or false if no endpoints captured.
   */
  getServicesUrl(): string | false;

  /**
   * Get all captured endpoints.
   * @returns All endpoints in capture order.
   */
  getAllEndpoints(): readonly IDiscoveredEndpoint[];

  /**
   * Discover the SPA URL from captured API traffic.
   * Finds the referer of the first API-domain endpoint (the SPA that made the call).
   * @returns SPA URL or false if no cross-domain API calls captured.
   */
  /**
   * Discover SPA URL from traffic — Tier 1: cross-domain referer, Tier 2: CORS allow-origin.
   * @param currentOrigin - Current page origin for CORS filtering.
   * @returns SPA URL or false.
   */
  discoverSpaUrl(currentOrigin?: string): string | false;

  /**
   * Discover endpoint by WellKnown API category.
   * Tries each pattern in the category until one matches.
   * @param patterns - Array of regex patterns (from PIPELINE_WELL_KNOWN_API).
   * @returns First matching endpoint or false.
   */
  discoverByPatterns(patterns: readonly RegExp[]): IDiscoveredEndpoint | false;

  /** Discover transactions endpoint via WellKnown patterns. */
  discoverTransactionsEndpoint(): IDiscoveredEndpoint | false;

  /** Discover balance endpoint via WellKnown patterns. */
  discoverBalanceEndpoint(): IDiscoveredEndpoint | false;

  /**
   * Discover auth token — 3-tier: headers → response bodies → sessionStorage.
   * Async because sessionStorage requires page.evaluate.
   * @returns Auth token string or false.
   */
  discoverAuthToken(): Promise<string | false>;

  /** Discover origin domain from captured request headers. */
  discoverOrigin(): string | false;

  /** Discover site ID from captured request headers (X-Site-Id, etc.). */
  discoverSiteId(): string | false;

  /**
   * Build fetch headers from ALL discovered auth values in traffic.
   * Uses 3-tier auth: request headers → response bodies → sessionStorage.
   * @returns IFetchOpts ready to pass to fetchStrategy.
   */
  buildDiscoveredHeaders(): Promise<IFetchOpts>;

  /**
   * Build a full transaction URL for an account from captured traffic templates.
   * Transforms dashboard summary URLs (forHomePage) into full history URLs (Date).
   * @param accountId - Account number.
   * @param startDate - Start date formatted (e.g., YYYYMMDD).
   * @returns Full transaction URL or false.
   */
  buildTransactionUrl(accountId: string, startDate: string): string | false;

  /**
   * Build a balance URL for an account from captured traffic templates.
   * @param accountId - Account number.
   * @returns Balance URL or false.
   */
  buildBalanceUrl(accountId: string): string | false;

  /**
   * Wait for a captured endpoint matching any pattern.
   * Polls every 500ms. Succeeds immediately on first match with response body.
   * @param patterns - WellKnown regex patterns to watch for.
   * @param timeoutMs - Max wait time.
   * @returns First matching endpoint or false on timeout.
   */
  waitForTraffic(
    patterns: readonly RegExp[],
    timeoutMs: number,
  ): Promise<IDiscoveredEndpoint | false>;

  /**
   * Event-driven wait for a WK transactions-shape endpoint to be captured.
   * Convenience wrapper over `waitForTraffic` that injects the canonical
   * `PIPELINE_WELL_KNOWN_API.transactions` pattern set, so callers (DASHBOARD
   * ACTION's nth-walker) don't need to import the WK constants.
   * @param timeoutMs - Max wait budget.
   * @returns First matching endpoint or false on timeout.
   */
  waitForTransactionsTraffic(timeoutMs: number): Promise<IDiscoveredEndpoint | false>;

  /**
   * Block until the captured pool yields a capture that surfaces an
   * account identifier — via the same 3-source predicate the auth phase
   * uses (response container, GET URL query, POST body). Used by the
   * ACCOUNT-RESOLVE phase to guarantee at least one id-bearing capture
   * has landed before discovery runs. Polls a closure-owned predicate
   * every 250 ms; returns the first match, or `false` when the budget
   * elapses with no match. Frozen networks return `false` immediately.
   * @param timeoutMs - Max wait budget in ms.
   * @returns First id-bearing endpoint or false on timeout.
   */
  waitForFirstId(timeoutMs: number): Promise<IDiscoveredEndpoint | false>;

  /**
   * Discover API origin from captured traffic.
   * 3-tier: config body scan → api.* subdomain → /api/ path.
   * @returns API origin URL or false.
   */
  discoverApiOrigin(): string | false;

  /**
   * Pre-cache auth token from iframes before SPA pivot detaches them.
   * Subsequent discoverAuthToken calls return the cached value.
   * @returns Cached token or false.
   */
  cacheAuthToken(): Promise<string | false>;

  /**
   * Generic auth-failure watcher attached to the live page. Fires when a
   * WK auth endpoint returns 4xx (Layer 1) or 200 with a body matching
   * any AUTH_BODY_FAILURE_PATTERNS row (Layer 2). Phase-bounded — the
   * LoginPhase disposes it before OTP / dashboard phases begin so
   * unrelated 4xx events on the same auth-URL family cannot pollute it.
   * Frozen-network contexts return a no-op watcher (always reports
   * "not failed" / "timeout").
   */
  readonly authFailureWatcher: IAuthFailureWatcher;
}

export type { IDiscoveredEndpoint, INetworkDiscovery };
