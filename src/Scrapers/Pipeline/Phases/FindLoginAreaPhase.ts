/**
 * FindLoginArea phase — discover and activate the credential form.
 *
 * PRE:    scan DOM for reveal elements → store RevealStatus in context
 * ACTION: fire clicks based on PRE discovery (READY/OBSCURED)
 * POST:   validate form is interactive → set loginAreaReady=true
 * FINAL:  default no-op
 */

import type { Page } from 'playwright-core';

import type { SelectorCandidate } from '../../Base/Config/LoginConfig.js';
import { ScraperErrorTypes } from '../../Base/ErrorTypes.js';
import type { ILoginConfig } from '../../Base/Interfaces/Config/LoginConfig.js';
import type { IElementMediator } from '../Mediator/ElementMediator.js';
import { WK } from '../Registry/PipelineWellKnown.js';
import { BasePhase } from '../Types/BasePhase.js';
import { some } from '../Types/Option.js';
import type {
  IFindLoginAreaDiscovery,
  IPipelineContext,
  RevealStatus,
} from '../Types/PipelineContext.js';
import type { Procedure } from '../Types/Procedure.js';
import { fail, isOk, succeed } from '../Types/Procedure.js';
import {
  tryClickCredentialArea,
  tryClickPrivateCustomers,
  tryClosePopup,
  waitForFirstField,
} from './GenericPreLoginSteps.js';
import { waitForCredentialsForm } from './HomePhase.js';

/** Timeout for credential area discovery — SPAs render asynchronously. */
const DISCOVER_TIMEOUT = 15_000;

/** Whether a DOM element count check matched (> 0). */
type ElementFound = boolean;
/** Raw DOM element count from Playwright locator.count(). */
type ElementCount = number;
/** Timeout for private-customers split navigation. */
const REVEAL_NAV_TIMEOUT = 15_000;

/**
 * Check if any WK.HOME.REVEAL text candidate exists in the DOM.
 * succeed(true) = at least one attached. succeed(false) = none found (valid).
 * @param page - Active Playwright page.
 * @returns Procedure with boolean detection result.
 */
async function isRevealAttached(page: Page): Promise<Procedure<boolean>> {
  const textCandidates = (WK.HOME.REVEAL as readonly SelectorCandidate[]).filter(
    (c): ElementFound => c.kind === 'textContent',
  );
  const countPromises = textCandidates.map(
    (c): Promise<ElementCount> =>
      page
        .getByText(c.value)
        .first()
        .count()
        .catch((): ElementCount => 0),
  );
  const counts = await Promise.all(countPromises);
  return succeed(counts.some((n): ElementFound => n > 0));
}

/**
 * Probe WK.HOME.REVEAL and return RevealStatus.
 * @param mediator - Active mediator.
 * @param page - Active page.
 * @param timeout - Race timeout ms.
 * @returns READY | OBSCURED | NOT_FOUND.
 */
async function probeRevealStatus(
  mediator: IElementMediator,
  page: Page,
  timeout: number,
): Promise<RevealStatus> {
  const candidates = WK.HOME.REVEAL as unknown as readonly SelectorCandidate[];
  const visibleResult = await mediator
    .resolveVisible(candidates, timeout)
    .catch((): false => false);
  if (visibleResult && visibleResult.found) return 'READY';
  const attachResult = await isRevealAttached(page);
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

/** FindLoginArea phase — BasePhase with PRE/ACTION/POST. */
class FindLoginAreaPhase extends BasePhase {
  public readonly name = 'find-login-area' as const;

  /**
   * PRE: close overlays + discover reveal element status.
   * @param _ctx - Pipeline context (unused).
   * @param input - Pipeline context with browser + mediator.
   * @returns Context enriched with findLoginAreaDiscovery.
   */
  public async pre(
    _ctx: IPipelineContext,
    input: IPipelineContext,
  ): Promise<Procedure<IPipelineContext>> {
    if (!input.browser.has) return fail(ScraperErrorTypes.Generic, 'No browser for FLA PRE');
    if (!input.mediator.has) return fail(ScraperErrorTypes.Generic, 'No mediator for FLA PRE');
    const page = input.browser.value.page;
    const mediator = input.mediator.value;
    await tryClosePopup(mediator);
    const privateCustomers = await probeRevealStatus(mediator, page, 3_000);
    const credentialArea = await probeRevealStatus(mediator, page, DISCOVER_TIMEOUT);
    const discovery: IFindLoginAreaDiscovery = { privateCustomers, credentialArea };
    return succeed({ ...input, findLoginAreaDiscovery: some(discovery) });
  }

  /**
   * ACTION: actuate based on PRE discovery. Skips NOT_FOUND entries.
   * @param ctx - Pipeline context with login config.
   * @param input - Pipeline context with findLoginAreaDiscovery.
   * @returns Same context (clicks are side-effects).
   */
  public async action(
    ctx: IPipelineContext,
    input: IPipelineContext,
  ): Promise<Procedure<IPipelineContext>> {
    if (!input.browser.has) return fail(ScraperErrorTypes.Generic, 'No browser for FLA ACTION');
    if (!input.mediator.has) return fail(ScraperErrorTypes.Generic, 'No mediator for FLA ACTION');
    const page = input.browser.value.page;
    const mediator = input.mediator.value;
    if (input.findLoginAreaDiscovery.has) {
      await fireRevealClicks(mediator, page, input.findLoginAreaDiscovery.value);
    }
    const config = ctx.config as unknown as ILoginConfig;
    if (config.preAction) await config.preAction(page).catch((): false => false);
    return succeed(input);
  }

  /**
   * POST: validate form is interactive → emit loginAreaReady=true.
   * @param ctx - Pipeline context with login config.
   * @param input - Pipeline context with browser + mediator.
   * @returns Context with loginAreaReady=true.
   */
  public async post(
    ctx: IPipelineContext,
    input: IPipelineContext,
  ): Promise<Procedure<IPipelineContext>> {
    if (!input.browser.has) return fail(ScraperErrorTypes.Generic, 'No browser for FLA POST');
    if (!input.mediator.has) return fail(ScraperErrorTypes.Generic, 'No mediator for FLA POST');
    const page = input.browser.value.page;
    const mediator = input.mediator.value;
    const fieldWait = waitForFirstField(page);
    await fieldWait.catch((): false => false);
    await waitForCredentialsForm(mediator);
    const config = ctx.config as unknown as ILoginConfig;
    if (config.checkReadiness) await config.checkReadiness(page).catch((): false => false);
    return succeed({ ...input, loginAreaReady: true });
  }
}

/**
 * Create the FindLoginArea phase instance.
 * @returns FindLoginAreaPhase.
 */
function createFindLoginAreaPhase(): FindLoginAreaPhase {
  return new FindLoginAreaPhase();
}

export { createFindLoginAreaPhase, FindLoginAreaPhase };
