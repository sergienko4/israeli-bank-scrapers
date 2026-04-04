/**
 * HOME phase — thin orchestration, all logic in Mediator/Home/HomeActions.
 * PRE:    locate login nav (WK_HOME.ENTRY)
 * ACTION: click + navigate to login page
 * POST:   validate page/iframe has login area
 * FINAL:  store loginUrl → signal to PRE-LOGIN
 */

import { ScraperErrorTypes } from '../../../Base/ErrorTypes.js';
import {
  executeLocateLoginNav,
  executeNavigateToLogin,
  executeStoreLoginSignal,
  executeValidateLoginArea,
} from '../../Mediator/Home/HomeActions.js';
import { BasePhase } from '../../Types/BasePhase.js';
import type { IPipelineContext } from '../../Types/PipelineContext.js';
import type { Procedure } from '../../Types/Procedure.js';
import { fail, succeed } from '../../Types/Procedure.js';

/** HOME phase — BasePhase with PRE/ACTION/POST/FINAL. */
class HomePhase extends BasePhase {
  public readonly name = 'home' as const;

  /** @inheritdoc */
  public async pre(
    _ctx: IPipelineContext,
    input: IPipelineContext,
  ): Promise<Procedure<IPipelineContext>> {
    void this.name;
    if (!input.mediator.has) return fail(ScraperErrorTypes.Generic, 'HOME PRE: no mediator');
    const result = await executeLocateLoginNav(input.mediator.value, input.logger);
    if (!result.success) return result;
    return succeed(input);
  }

  /** @inheritdoc */
  public async action(
    _ctx: IPipelineContext,
    input: IPipelineContext,
  ): Promise<Procedure<IPipelineContext>> {
    void this.name;
    if (!input.mediator.has) return fail(ScraperErrorTypes.Generic, 'HOME ACTION: no mediator');
    return executeNavigateToLogin(input.mediator.value, input, input.logger);
  }

  /** @inheritdoc */
  public async post(
    _ctx: IPipelineContext,
    input: IPipelineContext,
  ): Promise<Procedure<IPipelineContext>> {
    void this.name;
    if (!input.mediator.has) return fail(ScraperErrorTypes.Generic, 'HOME POST: no mediator');
    const homepageUrl = input.config.urls.base;
    return executeValidateLoginArea({
      mediator: input.mediator.value,
      input,
      homepageUrl,
      logger: input.logger,
    });
  }

  /** @inheritdoc */
  public final(
    _ctx: IPipelineContext,
    input: IPipelineContext,
  ): Promise<Procedure<IPipelineContext>> {
    void this.name;
    if (!input.mediator.has) {
      const err = fail(ScraperErrorTypes.Generic, 'HOME FINAL: no mediator');
      return Promise.resolve(err);
    }
    const signal = executeStoreLoginSignal(input.mediator.value, input, input.logger);
    return Promise.resolve(signal);
  }
}

/**
 * Create the HOME phase instance.
 * @returns HomePhase with PRE/ACTION/POST/FINAL.
 */
function createHomePhase(): HomePhase {
  return new HomePhase();
}

export { createHomePhase, HomePhase };
