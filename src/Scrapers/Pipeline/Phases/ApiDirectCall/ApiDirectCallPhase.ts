/**
 * API-DIRECT-CALL phase — thin orchestration bound to an
 * IApiDirectCallConfig literal. Zero bank knowledge.
 *
 * PRE    classify LoginKind from config + creds (diagnostic)
 * ACTION build+register strategy + primeSession + setRawAuth
 * POST   run config.probe (queryTag or urlTag)
 * FINAL  succeed(ctx) — ready for SCRAPE
 */

import {
  runApiDirectCallAction,
  runApiDirectCallPost,
  runApiDirectCallPre,
} from '../../Mediator/ApiDirectCall/ApiDirectCallActions.js';
import type { IApiDirectCallConfig } from '../../Mediator/ApiDirectCall/IApiDirectCallConfig.js';
import { BasePhase } from '../../Types/BasePhase.js';
import type { IActionContext, IPipelineContext } from '../../Types/PipelineContext.js';
import type { Procedure } from '../../Types/Procedure.js';
import { succeed } from '../../Types/Procedure.js';

/** API-DIRECT-CALL phase — BasePhase bound to a config literal. */
class ApiDirectCallPhase extends BasePhase {
  public readonly name = 'api-direct-call' as const;
  private readonly _config: IApiDirectCallConfig;

  /**
   * Create the phase bound to a bank's config literal.
   * @param config - Bank IApiDirectCallConfig literal.
   */
  constructor(config: IApiDirectCallConfig) {
    super();
    this._config = config;
  }

  /** @inheritdoc */
  public async pre(
    _ctx: IPipelineContext,
    input: IPipelineContext,
  ): Promise<Procedure<IPipelineContext>> {
    void this.name;
    return runApiDirectCallPre(this._config, input);
  }

  /** @inheritdoc */
  public async action(
    _ctx: IActionContext,
    input: IActionContext,
  ): Promise<Procedure<IActionContext>> {
    void this.name;
    const full = input as unknown as IPipelineContext;
    const result = await runApiDirectCallAction(this._config, full);
    return result as unknown as Procedure<IActionContext>;
  }

  /** @inheritdoc */
  public async post(
    _ctx: IPipelineContext,
    input: IPipelineContext,
  ): Promise<Procedure<IPipelineContext>> {
    void this.name;
    return runApiDirectCallPost(this._config, input);
  }

  /** @inheritdoc */
  public async final(
    _ctx: IPipelineContext,
    input: IPipelineContext,
  ): Promise<Procedure<IPipelineContext>> {
    void this.name;
    await Promise.resolve();
    return succeed(input);
  }
}

/**
 * Factory — build the API-DIRECT-CALL phase bound to a config literal.
 * @param config - Bank IApiDirectCallConfig literal.
 * @returns Phase instance.
 */
function createApiDirectCallPhase(config: IApiDirectCallConfig): ApiDirectCallPhase {
  return Reflect.construct(ApiDirectCallPhase, [config]);
}

export { ApiDirectCallPhase, createApiDirectCallPhase };
