/**
 * Post-login traffic probe — waits for organic SPA traffic after login.
 * SSO redirect fires transaction APIs from iframe — catch the fallout.
 * Uses WK patterns via mediator — zero hardcoded patterns in Phase code.
 */

import { PIPELINE_WELL_KNOWN_API } from '../../Registry/WK/ScrapeWK.js';
import type { ScraperLogger } from '../../Types/Debug.js';
import { maskVisibleText } from '../../Types/LogEvent.js';
import type { IElementMediator } from '../Elements/ElementMediator.js';

/** Max wait for organic SPA traffic after login. */
const TRAFFIC_WAIT_TIMEOUT = 30000;

/** Combined post-login traffic patterns via WK. */
const POST_LOGIN_PATTERNS: readonly RegExp[] = [
  ...PIPELINE_WELL_KNOWN_API.transactions,
  ...PIPELINE_WELL_KNOWN_API.accounts,
];

/**
 * Wait for organic SPA traffic after login submit.
 * SSO redirect fires transaction APIs from iframe — Patient Observer.
 * @param mediator - Element mediator with network discovery.
 * @param logger - Pipeline logger.
 * @returns True if transaction traffic detected.
 */
async function waitForPostLoginTraffic(
  mediator: IElementMediator,
  logger?: ScraperLogger,
): Promise<boolean> {
  const hit = await mediator.network.waitForTraffic(POST_LOGIN_PATTERNS, TRAFFIC_WAIT_TIMEOUT);
  if (hit) {
    logger?.trace({ event: 'login-validate', hasTraffic: true, url: maskVisibleText(hit.url) });
    return true;
  }
  const currentUrl = mediator.getCurrentUrl();
  logger?.trace({ event: 'login-validate', hasTraffic: false, url: maskVisibleText(currentUrl) });
  return false;
}

export default waitForPostLoginTraffic;
export { waitForPostLoginTraffic };
