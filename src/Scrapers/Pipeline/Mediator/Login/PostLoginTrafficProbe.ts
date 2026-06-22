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
  const sink: ScraperLogger | false = logger ?? false;
  const hit = await probePostLoginTraffic(mediator, budgetMs);
  const url = hit ? hit.url : mediator.getCurrentUrl();
  return logPostLoginTraffic(sink, !!hit, url);
}

export default waitForPostLoginTraffic;
export { waitForPostLoginTraffic };
