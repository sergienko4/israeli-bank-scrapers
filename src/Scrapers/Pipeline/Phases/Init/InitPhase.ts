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
import type { IPipelineContext } from '../../Types/PipelineContext.js';
import type { Procedure } from '../../Types/Procedure.js';

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
    _ctx: IPipelineContext,
    input: IPipelineContext,
  ): Promise<Procedure<IPipelineContext>> {
    void this.name;
    return executeNavigateToBank(input);
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

export { InitPhase };
export { createInitPhase, INIT_STEP } from './InitPhaseFactory.js';
