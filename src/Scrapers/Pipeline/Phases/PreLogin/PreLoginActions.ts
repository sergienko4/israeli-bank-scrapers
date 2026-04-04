/**
 * PreLogin actions — reveal clicks, portal navigation.
 * WK selector resolution delegated to Mediator/Home/HomeProbe.
 */

import type { Page } from 'playwright-core';

import type { IElementMediator } from '../../Mediator/Elements/ElementMediator.js';
import {
  tryClickCredentialArea,
  tryClickPrivateCustomers,
} from '../../Mediator/PreLogin/PreLoginActions.js';
import type { ScraperLogger } from '../../Types/Debug.js';
import type { IFindLoginAreaDiscovery, IPipelineContext } from '../../Types/PipelineContext.js';
import type { Procedure } from '../../Types/Procedure.js';
import { succeed } from '../../Types/Procedure.js';

export { probeRevealStatus } from '../../Mediator/PreLogin/PreLoginRevealProbe.js';

/** Timeout for private-customers split navigation. */
const REVEAL_NAV_TIMEOUT = 15_000;
/** Timeout for credential area discovery. */
const DISCOVER_TIMEOUT = 15_000;

/** Bundled args for firing reveal clicks. */
interface IFireRevealArgs {
  readonly mediator: IElementMediator;
  readonly page: Page;
  readonly discovery: IFindLoginAreaDiscovery;
  readonly logger: ScraperLogger;
}

/**
 * Fire reveal clicks based on PRE discovery.
 * @param args - Bundled reveal click arguments.
 * @returns False (best-effort).
 */
async function fireRevealClicks(args: IFireRevealArgs): Promise<false> {
  const { mediator, page, discovery, logger } = args;
  if (discovery.privateCustomers !== 'NOT_FOUND') {
    await tryClickPrivateCustomers({
      mediator,
      browserPage: page,
      navTimeout: REVEAL_NAV_TIMEOUT,
      logger,
    });
  }
  if (discovery.credentialArea !== 'NOT_FOUND') {
    await tryClickCredentialArea(mediator, logger);
  }
  return false;
}

/**
 * Navigate to portal if needed — no-op in Zero-Knowledge config.
 * HOME.ACTION already navigated to login entry point.
 * @param input - Pipeline context.
 * @returns Succeed (pass-through).
 */
function navigateToPortalIfNeeded(input: IPipelineContext): Procedure<IPipelineContext> {
  return succeed(input);
}

export { DISCOVER_TIMEOUT, fireRevealClicks, navigateToPortalIfNeeded };
