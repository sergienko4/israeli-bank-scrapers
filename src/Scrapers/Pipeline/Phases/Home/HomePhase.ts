/**
 * HOME phase — thin orchestration, all logic in Mediator/Home.
 * PRE:    passive discovery via HomeResolver (zero clicks)
 * ACTION: navigate to login via HomeActions (all clicks here)
 * POST:   validate page/iframe has login area
 * FINAL:  store loginUrl → signal to PRE-LOGIN
 */

import { ScraperErrorTypes } from '../../../Base/ErrorTypes.js';
import {
  executeHomeNavigation,
  executeStoreLoginSignal,
  executeValidateLoginArea,
} from '../../Mediator/Home/HomeActions.js';
import { type IHomeDiscovery, resolveHomeStrategy } from '../../Mediator/Home/HomeResolver.js';
import { BasePhase } from '../../Types/BasePhase.js';
import type { IActionContext, IPipelineContext } from '../../Types/PipelineContext.js';
import type { Procedure } from '../../Types/Procedure.js';
import { fail, succeed } from '../../Types/Procedure.js';

/** Cached discovery from PRE for ACTION. */
type CachedDiscovery = IHomeDiscovery | false;

/** HOME phase — BasePhase with PRE/ACTION/POST/FINAL. */
class HomePhase extends BasePhase {
  public readonly name = 'home' as const;
  private _discovery: CachedDiscovery = false;

  /** @inheritdoc */
  public async pre(
    _ctx: IPipelineContext,
    input: IPipelineContext,
  ): Promise<Procedure<IPipelineContext>> {
    void this.name;
    if (!input.mediator.has) return fail(ScraperErrorTypes.Generic, 'HOME PRE: no mediator');
    if (!input.browser.has) return fail(ScraperErrorTypes.Generic, 'HOME PRE: no browser');
    const page = input.browser.value.page;
    const result = await resolveHomeStrategy(input.mediator.value, input.logger, page);
    if (!result.success) return result;
    this._discovery = result.value;
    return succeed(input);
  }

  /** @inheritdoc */
  public async action(
    _ctx: IActionContext,
    input: IActionContext,
  ): Promise<Procedure<IActionContext>> {
    void this.name;
    if (!input.executor.has) return fail(ScraperErrorTypes.Generic, 'HOME ACTION: no executor');
    if (!this._discovery) return fail(ScraperErrorTypes.Generic, 'HOME ACTION: no discovery');
    await executeHomeNavigation(input.executor.value, this._discovery, input.logger);
    return succeed(input);
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
    return executeStoreLoginSignal(input.mediator.value, input, input.logger);
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
