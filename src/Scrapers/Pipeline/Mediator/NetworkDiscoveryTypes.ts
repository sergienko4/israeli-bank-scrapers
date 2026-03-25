/**
 * Types for network discovery — discovered endpoints and discovery interface.
 */

import type { IFetchOpts } from '../Strategy/FetchStrategy.js';

/** A discovered API endpoint — captured from browser network traffic. */
interface IDiscoveredEndpoint {
  /** Full URL including query params. */
  readonly url: string;
  /** HTTP method (GET or POST). */
  readonly method: 'GET' | 'POST';
  /** POST body if applicable. */
  readonly postData: string;
  /** Parsed JSON response body. */
  readonly responseBody: unknown;
  /** Response content type. */
  readonly contentType: string;
  /** Request headers sent by page JS (for auth token, origin, site ID). */
  readonly requestHeaders: Record<string, string>;
  /** Capture timestamp (ms since epoch). */
  readonly timestamp: number;
}

/** Network discovery interface — captures and queries API traffic. */
interface INetworkDiscovery {
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
  discoverSpaUrl(): string | false;

  /**
   * Discover endpoint by WellKnown API category.
   * Tries each pattern in the category until one matches.
   * @param patterns - Array of regex patterns (from PIPELINE_WELL_KNOWN_API).
   * @returns First matching endpoint or false.
   */
  discoverByPatterns(patterns: readonly RegExp[]): IDiscoveredEndpoint | false;

  /** Discover accounts endpoint via WellKnown patterns. */
  discoverAccountsEndpoint(): IDiscoveredEndpoint | false;

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
}

export type { IDiscoveredEndpoint, INetworkDiscovery };
