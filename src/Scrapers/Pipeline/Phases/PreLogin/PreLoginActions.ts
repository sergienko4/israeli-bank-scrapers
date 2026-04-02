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
import type { IFindLoginAreaDiscovery, IPipelineContext } from '../../Types/PipelineContext.js';
import type { Procedure } from '../../Types/Procedure.js';
import { succeed } from '../../Types/Procedure.js';

export { probeRevealStatus } from '../../Mediator/PreLogin/PreLoginRevealProbe.js';

/** Timeout for private-customers split navigation. */
const REVEAL_NAV_TIMEOUT = 15_000;
/** Timeout for credential area discovery. */
const DISCOVER_TIMEOUT = 15_000;

/**
 * Fire reveal clicks based on PRE discovery.
 * @param mediator - Active mediator.
 * @param page - Active page.
 * @param discovery - PRE discovery results.
 * @returns False (best-effort).
 */
async function fireRevealClicks(
  mediator: IElementMediator,
  page: Page,
  discovery: IFindLoginAreaDiscovery,
): Promise<false> {
  if (discovery.privateCustomers !== 'NOT_FOUND') {
    await tryClickPrivateCustomers(mediator, page, REVEAL_NAV_TIMEOUT);
  }
  if (discovery.credentialArea !== 'NOT_FOUND') {
    await tryClickCredentialArea(mediator);
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
