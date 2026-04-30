/**
 * INIT phase — thin orchestration, all logic in Mediator/Init/InitActions.
 * PRE:    launch browser + create page (get DNS)
 * ACTION: goto bank URL (navigate to page)
 * POST:   validate page loaded correctly
 * FINAL:  wire mediator + fetchStrategy → signal to HOME
 */

import {
  executeLaunchBrowser,
  executeNavigateToBank,
  executeValidatePage,
  executeWireComponents,
} from '../../Mediator/Init/InitActions.js';
import { BasePhase } from '../../Types/BasePhase.js';
import { none } from '../../Types/Option.js';
import type {
  IActionContext,
  IBootstrapContext,
  IPipelineContext,
} from '../../Types/PipelineContext.js';
import type { Procedure } from '../../Types/Procedure.js';
import { succeed } from '../../Types/Procedure.js';

/** None-stub fields for fresh pipeline context. */
const INIT_STUBS = {
  mediator: none(),
  login: none(),
  scrape: none(),
  fetchStrategy: none(),
  loginFieldDiscovery: none(),
  preLoginDiscovery: none(),
  dashboard: none(),
  scrapeDiscovery: none(),
  api: none(),
  otpConfig: none(),
  loginAreaReady: false,
};

/**
 * Build full pipeline context from bootstrap with none() stubs.
 * @param bootstrap - Bootstrap context from INIT.PRE.
 * @returns Full pipeline context ready for navigation.
 */
function buildFullFromBootstrap(bootstrap: IBootstrapContext): IPipelineContext {
  return { ...bootstrap, ...INIT_STUBS } as IPipelineContext;
}

/** INIT phase — BasePhase with PRE/ACTION/POST/FINAL. */
class InitPhase extends BasePhase {
  public readonly name = 'init' as const;

  /** @inheritdoc */
  public async pre(
    _ctx: IPipelineContext,
    input: IPipelineContext,
  ): Promise<Procedure<IPipelineContext>> {
    void this.name;
    return executeLaunchBrowser(input);
  }

  /** @inheritdoc */
  public async action(
    _ctx: IActionContext,
    input: IActionContext,
  ): Promise<Procedure<IActionContext>> {
    void this.name;
    const bootstrap = input as IBootstrapContext;
    const full = buildFullFromBootstrap(bootstrap);
    const navResult = await executeNavigateToBank(full);
    if (!navResult.success) return navResult;
    return succeed(input);
  }

  /** @inheritdoc */
  public async post(
    _ctx: IPipelineContext,
    input: IPipelineContext,
  ): Promise<Procedure<IPipelineContext>> {
    void this.name;
    return executeValidatePage(input);
  }

  /** @inheritdoc */
  public final(
    _ctx: IPipelineContext,
    input: IPipelineContext,
  ): Promise<Procedure<IPipelineContext>> {
    void this.name;
    const wired = executeWireComponents(input);
    return Promise.resolve(wired);
  }
}

export { createInitPhase, INIT_STEP } from './InitPhaseFactory.js';
export { InitPhase };
