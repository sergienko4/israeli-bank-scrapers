/**
 * HOME phase — thin orchestration, all logic in Mediator/Home.
 * PRE:    passive discovery via HomeResolver (zero clicks)
 * ACTION: navigate to login via HomeActions (all clicks here)
 * POST:   validate page/iframe has login area
 * FINAL:  store loginUrl → signal to PRE-LOGIN
 */

import { ScraperErrorTypes } from '../../../Base/ErrorTypes.js';
import type { IPreludeSpec } from '../../Mediator/Elements/PagePrelude.js';
import { PRELUDE_NONE } from '../../Mediator/Elements/PagePrelude.js';
import {
  executeHomeNavigation,
  executeStoreLoginSignal,
  executeValidateLoginArea,
} from '../../Mediator/Home/HomeActions.js';
import { resolveHomeWithRecovery, toRecoveryArgs } from '../../Mediator/Home/HomeCrashRecovery.js';
import type { IHomeDiscovery } from '../../Mediator/Home/HomeResolver.js';
import { HOME_PRELUDE_TIMEOUT_MS } from '../../Mediator/Timing/TimingConfig.js';
import { BasePhase } from '../../Types/BasePhase.js';
import type { IActionContext, IPipelineContext } from '../../Types/PipelineContext.js';
import type { Procedure } from '../../Types/Procedure.js';
import { fail, succeed } from '../../Types/Procedure.js';

/** HOME prelude spec — SPA-ready, single source for PRE + ACTION. */
const HOME_PRELUDE_SPA: IPreludeSpec = { level: 'spa', timeoutMs: HOME_PRELUDE_TIMEOUT_MS };

/** HOME prelude table — PRE/ACTION wait for SPA-ready; POST/FINAL no-op. */
const HOME_PRELUDE_TABLE: Record<'PRE' | 'ACTION' | 'POST' | 'FINAL', IPreludeSpec> = {
  PRE: HOME_PRELUDE_SPA,
  ACTION: HOME_PRELUDE_SPA,
  POST: PRELUDE_NONE,
  FINAL: PRELUDE_NONE,
};

/** HOME phase — BasePhase with PRE/ACTION/POST/FINAL. */
class HomePhase extends BasePhase {
  public readonly name = 'home' as const;
  private _discovery: IHomeDiscovery | false = false;
  private readonly _preludeTable = HOME_PRELUDE_TABLE;

  /** @inheritdoc */
  public async pre(
    _ctx: IPipelineContext,
    input: IPipelineContext,
  ): Promise<Procedure<IPipelineContext>> {
    if (!input.mediator.has) return fail(ScraperErrorTypes.Generic, 'HOME PRE: no mediator');
    if (!input.browser.has) return fail(ScraperErrorTypes.Generic, 'HOME PRE: no browser');
    const args = toRecoveryArgs(input, input.mediator.value, input.browser.value.page);
    const result = await resolveHomeWithRecovery(args);
    if (!result.success) return result;
    this._discovery = result.value;
    return succeed(input);
  }

  /** @inheritdoc */
  public async action(
    _ctx: IActionContext,
    input: IActionContext,
  ): Promise<Procedure<IActionContext>> {
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
    if (!input.mediator.has) return fail(ScraperErrorTypes.Generic, 'HOME POST: no mediator');
    input.logger.debug({ phase: this.name, message: 'home.post' });
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
    input.logger.debug({ phase: this.name, message: 'home.final' });
    if (!input.mediator.has) {
      const err = fail(ScraperErrorTypes.Generic, 'HOME FINAL: no mediator');
      return Promise.resolve(err);
    }
    return executeStoreLoginSignal(input.mediator.value, input, input.logger);
  }

  /**
   * HOME requires SPA-ready (HTML parsed + JS bundles loaded + network
   * idle) before PRE scans for the login trigger AND before ACTION
   * clicks. Without this gate, banks like Visacal whose login button is
   * `<a href="#" onclick="">` with an async-bound handler fall through
   * to default hash navigation and the modal never opens.
   *
   * @param stage - The stage about to execute.
   * @returns SPA prelude for PRE / ACTION; none otherwise.
   */
  protected override prelude(stage: 'PRE' | 'ACTION' | 'POST' | 'FINAL'): IPreludeSpec {
    return this._preludeTable[stage];
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
