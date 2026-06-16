import type { IDiscoveredEndpoint } from '../../Mediator/Network/Types/Endpoint.js';
import type { ITxnEndpoint } from './TxnEndpointTypes.js';

/** Scrape phase discovery — qualification results from PRE step. */
interface IScrapeDiscovery {
  /** Card IDs that passed the behavioral probe (API returned success). */
  readonly qualifiedCards: readonly string[];
  /** Card IDs that failed the probe (API returned error). */
  readonly prunedCards: readonly string[];
  /** Discovered transaction template URL. */
  readonly txnTemplateUrl: string;
  /** Discovered transaction template POST body. */
  readonly txnTemplateBody: Record<string, unknown>;
  /** Billing months for 90-day replay. */
  readonly billingMonths: readonly string[];
  /** cardIndex → cardNumber display map (Isracard/Amex: last 4 digits). */
  readonly cardDisplayMap?: ReadonlyMap<string, string>;
  /** SPA URL for direct-fetch scrapers (false = no SPA navigation needed). */
  readonly spaUrl?: string | false;
  /** Raw account records from API discovery. */
  readonly rawAccountRecords?: readonly Record<string, unknown>[];
  /** Whether SPA navigation completed successfully. */
  readonly spaNavigated?: boolean;

  // ── DIRECT path fields (frozen discovery from PRE) ──

  /** Frozen snapshot of ALL captured endpoints for createFrozenNetwork. */
  readonly frozenEndpoints?: readonly IDiscoveredEndpoint[];
  /** Discovered account IDs from accounts endpoint. */
  readonly accountIds?: readonly string[];
  /** Transaction endpoint for account iteration. */
  readonly txnEndpoint?: ITxnEndpoint;
  /** Pre-cached auth token from DASHBOARD. */
  readonly cachedAuth?: string | false;
  /**
   * Dashboard navigation-click timestamp inherited from the live
   * network at freeze time. Lets the frozen network split captures
   * into pre-nav vs post-nav buckets so SCRAPE.PRE's discovery sees
   * the same post-nav-aware view as DASHBOARD.FINAL did. `false`
   * when no click was dispatched (banks like Hapoalim that fire
   * full-history at login) — the frozen network's soft-fallback then
   * exposes the full pool.
   */
  readonly dashboardClickAt?: number | false;
  /** Harvested sessionStorage key-value pairs. */
  readonly storageHarvest?: Readonly<Record<string, string>>;
  /** DIRECT_API: raw card/account response from DASHBOARD.ACTION. */
  readonly directApiResponse?: Record<string, unknown>;
  /** DIRECT_API: transaction endpoint URL from config. */
  readonly directApiTxnUrl?: string;
}

export type { IScrapeDiscovery };
