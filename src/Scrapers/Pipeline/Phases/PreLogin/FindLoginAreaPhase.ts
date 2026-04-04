/**
 * PRE-LOGIN phase — thin orchestration, all logic in Mediator.
 * PRE:    locate reveal toggles (some banks don't hide login area)
 * ACTION: click reveal, navigate
 * POST:   validate login form visible (password + submit)
 * FINAL:  prove form loaded → signal to LOGIN
 */

import { ScraperErrorTypes } from '../../../Base/ErrorTypes.js';
import {
  executeFireRevealClicks,
  executePreLocateReveal,
  executeSignalToLogin,
  executeValidateForm,
} from '../../Mediator/PreLogin/PreLoginPhaseActions.js';
import { BasePhase } from '../../Types/BasePhase.js';
import type { IPipelineContext } from '../../Types/PipelineContext.js';
import type { Procedure } from '../../Types/Procedure.js';
import { fail } from '../../Types/Procedure.js';

/** PRE-LOGIN phase — BasePhase with PRE/ACTION/POST/FINAL. */
class FindLoginAreaPhase extends BasePhase {
  public readonly name = 'find-login-area' as const;

  /** @inheritdoc */
  public async pre(
    _ctx: IPipelineContext,
    input: IPipelineContext,
  ): Promise<Procedure<IPipelineContext>> {
    void this.name;
    if (!input.mediator.has) return fail(ScraperErrorTypes.Generic, 'PRE-LOGIN PRE: no mediator');
    return executePreLocateReveal(input.mediator.value, input);
  }

  /** @inheritdoc */
  public async action(
    _ctx: IPipelineContext,
    input: IPipelineContext,
  ): Promise<Procedure<IPipelineContext>> {
    void this.name;
    if (!input.browser.has) return fail(ScraperErrorTypes.Generic, 'PRE-LOGIN ACTION: no browser');
    if (!input.mediator.has)
      return fail(ScraperErrorTypes.Generic, 'PRE-LOGIN ACTION: no mediator');
    return executeFireRevealClicks(input.mediator.value, input.browser.value.page, input);
  }

  /** @inheritdoc */
  public async post(
    _ctx: IPipelineContext,
    input: IPipelineContext,
  ): Promise<Procedure<IPipelineContext>> {
    void this.name;
    if (!input.mediator.has) return fail(ScraperErrorTypes.Generic, 'PRE-LOGIN POST: no mediator');
    return executeValidateForm(input.mediator.value, input);
  }

  /** @inheritdoc */
  public final(
    _ctx: IPipelineContext,
    input: IPipelineContext,
  ): Promise<Procedure<IPipelineContext>> {
    void this.name;
    const signal = executeSignalToLogin(input);
    return Promise.resolve(signal);
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
