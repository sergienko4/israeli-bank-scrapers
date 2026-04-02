/**
 * FindLoginArea phase — discover and activate the credential form.
 * PRE: scan DOM for reveal elements. ACTION: fire clicks. POST: validate form.
 * All WK + DOM logic delegated to Mediator — Phase only orchestrates.
 */

import type { Page } from 'playwright-core';

import { ScraperErrorTypes } from '../../../Base/ErrorTypes.js';
import type { IElementMediator } from '../../Mediator/Elements/ElementMediator.js';
import {
  isFormAlreadyVisible,
  validateFormGatePost,
} from '../../Mediator/PreLogin/PreLoginActions.js';
import { BasePhase } from '../../Types/BasePhase.js';
import { some } from '../../Types/Option.js';
import type { IFindLoginAreaDiscovery, IPipelineContext } from '../../Types/PipelineContext.js';
import type { Procedure } from '../../Types/Procedure.js';
import { fail, succeed } from '../../Types/Procedure.js';
import {
  DISCOVER_TIMEOUT,
  fireRevealClicks,
  navigateToPortalIfNeeded,
  probeRevealStatus,
} from './PreLoginActions.js';

/**
 * PRE probe: check if form exists, if not probe for reveals.
 * @param mediator - Active mediator.
 * @returns Discovery results.
 */
async function runPreProbe(mediator: IElementMediator): Promise<IFindLoginAreaDiscovery> {
  process.stderr.write(`    [PRE-LOGIN.PRE] URL=${mediator.getCurrentUrl()}\n`);
  if (await isFormAlreadyVisible(mediator)) {
    process.stderr.write('    [PRE-LOGIN.PRE] form ALREADY VISIBLE\n');
    return { privateCustomers: 'NOT_FOUND', credentialArea: 'NOT_FOUND' };
  }
  process.stderr.write('    [PRE-LOGIN.PRE] probing reveal\n');
  const privateCustomers = await probeRevealStatus(mediator, 3_000);
  const credentialArea = await probeRevealStatus(mediator, DISCOVER_TIMEOUT);
  return { privateCustomers, credentialArea };
}

/**
 * Run ACTION: fire reveal clicks + diagnostics.
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
    const disc = input.findLoginAreaDiscovery.value;
    await fireRevealClicks(mediator, page, disc);
  }
  const hasPwd = await isFormAlreadyVisible(mediator);
  const iframes = page.frames().length - 1;
  process.stderr.write(`    [PRE-LOGIN.ACTION] pwd=${String(hasPwd)} iframes=${String(iframes)}\n`);
  return succeed(input);
}

/**
 * Run POST: validate form is interactive via mediator.
 * @param mediator - Active mediator.
 * @param ctx - Pipeline context with login config.
 * @returns Succeed with loginAreaReady.
 */
async function runPost(
  mediator: IElementMediator,
  ctx: IPipelineContext,
): Promise<Procedure<IPipelineContext>> {
  const isReady = await validateFormGatePost(mediator);
  if (!isReady) {
    process.stderr.write('    [PRE-LOGIN.POST] FAIL: no password field\n');
    return fail(ScraperErrorTypes.Generic, 'PRE-LOGIN: no password field');
  }
  process.stderr.write(`    [PRE-LOGIN.POST] FOUND at ${mediator.getCurrentUrl()}\n`);
  return succeed({ ...ctx, loginAreaReady: true });
}

/** FindLoginArea phase — BasePhase with PRE/ACTION/POST. */
class FindLoginAreaPhase extends BasePhase {
  public readonly name = 'find-login-area' as const;

  /** @inheritdoc */
  public async pre(
    _ctx: IPipelineContext,
    input: IPipelineContext,
  ): Promise<Procedure<IPipelineContext>> {
    void this.name;
    if (!input.mediator.has) return fail(ScraperErrorTypes.Generic, 'No mediator for FLA PRE');
    if (!input.browser.has) return fail(ScraperErrorTypes.Generic, 'No browser for FLA PRE');
    const portalNav = navigateToPortalIfNeeded(input);
    if (!portalNav.success) return portalNav;
    const discovery = await runPreProbe(input.mediator.value);
    return succeed({ ...input, findLoginAreaDiscovery: some(discovery) });
  }

  /** @inheritdoc */
  public async action(
    _ctx: IPipelineContext,
    input: IPipelineContext,
  ): Promise<Procedure<IPipelineContext>> {
    void this.name;
    if (!input.browser.has) return fail(ScraperErrorTypes.Generic, 'No browser for FLA ACTION');
    if (!input.mediator.has) return fail(ScraperErrorTypes.Generic, 'No mediator for FLA ACTION');
    const page = input.browser.value.page;
    return await runAction(page, input.mediator.value, input);
  }

  /** @inheritdoc */
  public async post(
    ctx: IPipelineContext,
    input: IPipelineContext,
  ): Promise<Procedure<IPipelineContext>> {
    void this.name;
    if (!input.mediator.has) return fail(ScraperErrorTypes.Generic, 'No mediator for FLA POST');
    return await runPost(input.mediator.value, ctx);
  }

  /**
   * FINAL: validate loginAreaReady was set by POST.
   * @param _ctx - Unused.
   * @param input - Pipeline context.
   * @returns Succeed if ready.
   */
  public final(
    _ctx: IPipelineContext,
    input: IPipelineContext,
  ): Promise<Procedure<IPipelineContext>> {
    void this.name;
    if (!input.loginAreaReady) {
      const err = fail(ScraperErrorTypes.Generic, 'FLA final: not ready');
      return Promise.resolve(err);
    }
    const ok = succeed(input);
    return Promise.resolve(ok);
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
