/**
 * FindLoginArea helpers — reveal detection, click actions.
 * Extracted from FindLoginAreaPhase.ts to respect max-lines.
 */

import type { Page } from 'playwright-core';

import type { SelectorCandidate } from '../../../Base/Config/LoginConfig.js';
import type { IElementMediator } from '../../Mediator/Elements/ElementMediator.js';
import { WK_HOME } from '../../Registry/WK/HomeWK.js';
import {
  tryClickCredentialArea,
  tryClickPrivateCustomers,
} from '../../Strategy/GenericPreLoginSteps.js';
import type { IFindLoginAreaDiscovery, RevealStatus } from '../../Types/PipelineContext.js';
import type { Procedure } from '../../Types/Procedure.js';
import { isOk, succeed } from '../../Types/Procedure.js';

/** Whether a DOM element count check matched (> 0). */
type ElementFound = boolean;
/** Raw DOM element count from Playwright locator.count(). */
type ElementCount = number;
/** Timeout for private-customers split navigation. */
const REVEAL_NAV_TIMEOUT = 15_000;
/** Timeout for credential area discovery. */
const DISCOVER_TIMEOUT = 15_000;

/**
 * Check if any WK.HOME.REVEAL text candidate exists in the DOM.
 * @param mediator - Active mediator for element queries.
 * @returns Procedure with boolean detection result.
 */
async function isRevealAttached(mediator: IElementMediator): Promise<Procedure<boolean>> {
  const textCandidates = (WK_HOME.REVEAL as readonly SelectorCandidate[]).filter(
    (c): ElementFound => c.kind === 'textContent',
  );
  const countPromises = textCandidates.map(
    (c): Promise<ElementCount> => mediator.countByText(c.value),
  );
  const counts = await Promise.all(countPromises);
  const isAttached = counts.some((n): ElementFound => n > 0);
  return succeed(isAttached);
}

/**
 * Probe WK.HOME.REVEAL and return RevealStatus.
 * @param mediator - Active mediator.
 * @param timeout - Race timeout ms.
 * @returns READY | OBSCURED | NOT_FOUND.
 */
async function probeRevealStatus(
  mediator: IElementMediator,
  timeout: number,
): Promise<RevealStatus> {
  const candidates = WK_HOME.REVEAL as unknown as readonly SelectorCandidate[];
  const visibleResult = await mediator
    .resolveVisible(candidates, timeout)
    .catch((): false => false);
  if (visibleResult && visibleResult.found) return 'READY';
  const attachResult = await isRevealAttached(mediator);
  if (isOk(attachResult) && attachResult.value) return 'OBSCURED';
  return 'NOT_FOUND';
}

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

export { DISCOVER_TIMEOUT, fireRevealClicks, probeRevealStatus };
