/**
 * Post-login traffic probe — waits for organic SPA traffic after login.
 * SSO redirect fires transaction APIs from iframe — catch the fallout.
 * Uses WK patterns via mediator — zero hardcoded patterns in Phase code.
 */

import { PIPELINE_WELL_KNOWN_API } from '../../Registry/WK/ScrapeWK.js';
import type { ScraperLogger } from '../../Types/Debug.js';
import { maskVisibleText } from '../../Types/LogEvent.js';
import type { IElementMediator } from '../Elements/ElementMediator.js';
import type { IDiscoveredEndpoint } from '../Network/NetworkDiscoveryTypes.js';
import { LOGIN_TRAFFIC_WAIT_TIMEOUT_MS } from '../Timing/TimingConfig.js';

/**
 * Post-login traffic gate — Phase 7e R-AUTH-CLEANUP: no WK_API.transactions
 * peek inside the auth boundary. The post-login signal is the bank's first
 * authenticated dashboard fetch (account-init class endpoints), which fires
 * before any transactions traffic on every observed bank. TXN-side
 * discovery is owned by DASHBOARD.FINAL via {@link resolveTxnEndpoint}.
 */
const POST_LOGIN_PATTERNS: readonly RegExp[] = [...PIPELINE_WELL_KNOWN_API.accounts];

/**
 * Emit a PII-safe `hasTraffic` trace event for the post-login wait.
 * @param logger - Optional pipeline logger.
 * @param hasTraffic - Whether the wait observed organic traffic.
 * @param url - URL to mask and emit (request URL on hit, page URL on miss).
 * @returns The `hasTraffic` flag verbatim so callers can return it.
 */
function logPostLoginTraffic(
  logger: ScraperLogger | false,
  hasTraffic: boolean,
  url: string,
): boolean {
  if (logger !== false) logger.trace({ hasTraffic, url: maskVisibleText(url) });
  return hasTraffic;
}

/**
 * Probe network traffic for post-login API patterns.
 * @param mediator - Element mediator with network discovery.
 * @param budgetMs - Wait ceiling in ms; defaults to LOGIN_TRAFFIC_WAIT_TIMEOUT_MS.
 * @returns First traffic hit or false.
 */
async function probePostLoginTraffic(
  mediator: IElementMediator,
  budgetMs: number = LOGIN_TRAFFIC_WAIT_TIMEOUT_MS,
): Promise<IDiscoveredEndpoint | false> {
  return mediator.network.waitForTraffic(POST_LOGIN_PATTERNS, budgetMs);
}

/**
 * Resolve a URL's host for histogram bucketing. PII-safe — host only, no
 * path or query string. Returns 'invalid' for an unparseable URL.
 * @param url - Captured endpoint URL.
 * @returns The URL host, or 'invalid'.
 */
function safeHost(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return 'invalid';
  }
}

/**
 * Bucket the captured-response pool by host into a count histogram.
 * @param pool - Captured discovered endpoints.
 * @returns Host → response-count map (PII-safe: hosts only, no full URLs).
 */
function poolHostHistogram(pool: readonly IDiscoveredEndpoint[]): Record<string, number> {
  return pool.reduce<Record<string, number>>((acc, endpoint) => {
    const host = safeHost(endpoint.url);
    acc[host] = (acc[host] ?? 0) + 1;
    return acc;
  }, {});
}

/**
 * Auth-confirm wait outcome passed to the pool-histogram emitter.
 */
interface IAuthConfirmProbe {
  readonly hasTraffic: boolean;
  readonly startedMs: number;
}

/**
 * PII-safe `login.authconfirm.pool` debug payload: scalar counts plus a
 * host-only histogram of the captured response pool at the auth-confirm gate.
 */
interface IAuthConfirmPoolEvent {
  readonly event: string;
  readonly total: number;
  readonly successful: number;
  readonly hosts: Record<string, number>;
  readonly hasTraffic: boolean;
  readonly elapsedMs: number;
}

/**
 * Build the PII-safe auth-confirm pool event from network discovery.
 * @param network - Mediator network discovery (read-only access).
 * @param probe - Wait outcome and start time.
 * @returns The assembled histogram event.
 */
function poolEvent(
  network: IElementMediator['network'],
  probe: IAuthConfirmProbe,
): IAuthConfirmPoolEvent {
  const pool = network.getAllEndpoints();
  const successful = network.countSuccessfulResponses();
  const counts = { total: pool.length, successful, hosts: poolHostHistogram(pool) };
  const timing = { hasTraffic: probe.hasTraffic, elapsedMs: Date.now() - probe.startedMs };
  return { event: 'login.authconfirm.pool', ...counts, ...timing };
}

/**
 * Emit a PII-safe pool histogram at the auth-confirm gate. Reads the existing
 * in-memory pool via {@link IElementMediator.network} (no new page listeners —
 * Camoufox fingerprint stays unchanged), making an analytics-only Amex trace
 * (zero first-party responses) directly diffable against a green control bank.
 * @param mediator - Element mediator with network discovery.
 * @param logger - Pipeline logger.
 * @param probe - Wait outcome and start time.
 * @returns The emitted histogram event.
 */
function emitAuthConfirmPool(
  mediator: IElementMediator,
  logger: ScraperLogger,
  probe: IAuthConfirmProbe,
): IAuthConfirmPoolEvent {
  const event = poolEvent(mediator.network, probe);
  logger.debug(event);
  return event;
}

/**
 * Wait for organic SPA traffic after login submit.
 * SSO redirect fires transaction APIs from iframe — Patient Observer.
 * @param mediator - Element mediator with network discovery.
 * @param logger - Pipeline logger.
 * @param budgetMs - Wait ceiling in ms; defaults to LOGIN_TRAFFIC_WAIT_TIMEOUT_MS.
 * @returns True if transaction traffic detected.
 */
async function waitForPostLoginTraffic(
  mediator: IElementMediator,
  logger?: ScraperLogger,
  budgetMs: number = LOGIN_TRAFFIC_WAIT_TIMEOUT_MS,
): Promise<boolean> {
  const startedMs = Date.now();
  const hit = await probePostLoginTraffic(mediator, budgetMs);
  if (logger) emitAuthConfirmPool(mediator, logger, { hasTraffic: !!hit, startedMs });
  return logPostLoginTraffic(logger ?? false, !!hit, hit ? hit.url : mediator.getCurrentUrl());
}

export default waitForPostLoginTraffic;
export { waitForPostLoginTraffic };
