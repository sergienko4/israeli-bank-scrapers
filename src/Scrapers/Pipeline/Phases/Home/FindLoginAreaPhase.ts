/**
 * FindLoginArea phase — discover and activate the credential form.
 *
 * PRE:    scan DOM for reveal elements
 * ACTION: fire clicks based on PRE discovery
 * POST:   validate form is interactive
 */

import type { Page } from 'playwright-core';

import { ScraperErrorTypes } from '../../../Base/ErrorTypes.js';
import type { ILoginConfig } from '../../../Base/Interfaces/Config/LoginConfig.js';
import type { IElementMediator } from '../../Mediator/Elements/ElementMediator.js';
import { waitForFirstField } from '../../Strategy/GenericPreLoginSteps.js';
import { BasePhase } from '../../Types/BasePhase.js';
import { some } from '../../Types/Option.js';
import type { IFindLoginAreaDiscovery, IPipelineContext } from '../../Types/PipelineContext.js';
import type { Procedure } from '../../Types/Procedure.js';
import { fail, succeed } from '../../Types/Procedure.js';
import { DISCOVER_TIMEOUT, fireRevealClicks, probeRevealStatus } from './FindLoginAreaHelpers.js';
import { waitForCredentialsForm } from './HomePhase.js';

/**
 * Run PRE: probe reveal status for private customers and credential area.
 * @param mediator - Active mediator.
 * @returns Discovery results.
 */
async function runPreProbe(mediator: IElementMediator): Promise<IFindLoginAreaDiscovery> {
  const privateCustomers = await probeRevealStatus(mediator, 3_000);
  const credentialArea = await probeRevealStatus(mediator, DISCOVER_TIMEOUT);
  return { privateCustomers, credentialArea };
}

/**
 * Run ACTION: fire reveal clicks + preAction callback.
 * @param page - Browser page.
 * @param mediator - Active mediator.
 * @param input - Pipeline context.
 * @returns Succeed with input.
 */
async function runAction(
  page: Page,
  mediator: IElementMediator,
  input: IPipelineContext,
): Promise<Procedure<IPipelineContext>> {
  if (input.findLoginAreaDiscovery.has) {
    await fireRevealClicks(mediator, page, input.findLoginAreaDiscovery.value);
  }
  const config = input.config as unknown as ILoginConfig;
  if (config.preAction) await config.preAction(page).catch((): false => false);
  return succeed(input);
}

/**
 * Run POST: validate form is interactive.
 * @param page - Browser page.
 * @param mediator - Active mediator.
 * @param ctx - Pipeline context with login config.
 * @returns Succeed with loginAreaReady.
 */
async function runPost(
  page: Page,
  mediator: IElementMediator,
  ctx: IPipelineContext,
): Promise<Procedure<IPipelineContext>> {
  const fieldWait = waitForFirstField(page);
  await fieldWait.catch((): false => false);
  await waitForCredentialsForm(mediator);
  const config = ctx.config as unknown as ILoginConfig;
  if (config.checkReadiness) await config.checkReadiness(page).catch((): false => false);
  return succeed({ ...ctx, loginAreaReady: true });
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
    void this.name;
    if (!input.mediator.has) return fail(ScraperErrorTypes.Generic, 'No mediator for FLA PRE');
    const discovery = await runPreProbe(input.mediator.value);
    return succeed({ ...input, findLoginAreaDiscovery: some(discovery) });
  }

  /**
   * ACTION: actuate based on PRE discovery.
   * @param _ctx - Pipeline context (unused).
   * @param input - Pipeline context with findLoginAreaDiscovery.
   * @returns Same context (clicks are side-effects).
   */
  public async action(
    _ctx: IPipelineContext,
    input: IPipelineContext,
  ): Promise<Procedure<IPipelineContext>> {
    void this.name;
    if (!input.browser.has) return fail(ScraperErrorTypes.Generic, 'No browser for FLA ACTION');
    if (!input.mediator.has) return fail(ScraperErrorTypes.Generic, 'No mediator for FLA ACTION');
    return await runAction(input.browser.value.page, input.mediator.value, input);
  }

  /**
   * POST: validate form is interactive.
   * @param ctx - Pipeline context with login config.
   * @param input - Pipeline context with browser + mediator.
   * @returns Context with loginAreaReady=true.
   */
  public async post(
    ctx: IPipelineContext,
    input: IPipelineContext,
  ): Promise<Procedure<IPipelineContext>> {
    void this.name;
    if (!input.browser.has) return fail(ScraperErrorTypes.Generic, 'No browser for FLA POST');
    if (!input.mediator.has) return fail(ScraperErrorTypes.Generic, 'No mediator for FLA POST');
    return await runPost(input.browser.value.page, input.mediator.value, ctx);
  }

  /**
   * FINAL: validate loginAreaReady was set by POST.
   * @param _ctx - Pipeline context (unused).
   * @param input - Pipeline context with loginAreaReady flag.
   * @returns Succeed if ready, fail otherwise.
   */
  public final(
    _ctx: IPipelineContext,
    input: IPipelineContext,
  ): Promise<Procedure<IPipelineContext>> {
    void this.name;
    if (!input.loginAreaReady) {
      const err = fail(ScraperErrorTypes.Generic, 'FLA final: loginAreaReady not set');
      return Promise.resolve(err);
    }
    const result = succeed(input);
    return Promise.resolve(result);
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
