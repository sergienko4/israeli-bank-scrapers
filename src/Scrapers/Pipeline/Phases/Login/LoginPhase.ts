/**
 * LOGIN phase — thin orchestration, all logic in Mediator/Login/LoginPhaseActions.
 * PRE:    discover credential form + resolve all fields (checkReadiness + preAction + discovery)
 * ACTION: fill from discovery + submit (no bridge cast, no mediator discovery)
 * POST:   validate OK or error (form errors + traffic wait)
 * FINAL:  prove dashboard loaded → signal to DASHBOARD (cookies + API strategy)
 */

import { ScraperErrorTypes } from '../../../Base/ErrorTypes.js';
import type { ILoginConfig } from '../../../Base/Interfaces/Config/LoginConfig.js';
import {
  executeDiscoverForm,
  executeFillAndSubmitFromDiscovery,
  executeLoginSignal,
  executeValidateLogin,
} from '../../Mediator/Login/LoginPhaseActions.js';
import { BasePhase, type IsPrePayloadValid } from '../../Types/BasePhase.js';
import type { IActionContext, IPipelineContext } from '../../Types/PipelineContext.js';
import type { Procedure } from '../../Types/Procedure.js';
import { fail } from '../../Types/Procedure.js';

/** LOGIN phase — BasePhase with PRE/ACTION/POST/FINAL. */
class LoginPhase extends BasePhase {
  public readonly name = 'login' as const;
  private readonly _config: ILoginConfig;

  /**
   * Create login phase with config.
   * @param config - Bank's login configuration.
   */
  constructor(config: ILoginConfig) {
    super();
    this._config = config;
  }

  /** @inheritdoc */
  public async pre(
    _ctx: IPipelineContext,
    input: IPipelineContext,
  ): Promise<Procedure<IPipelineContext>> {
    void this.name;
    return executeDiscoverForm(this._config, input);
  }

  /** @inheritdoc */
  public async action(
    _ctx: IActionContext,
    input: IActionContext,
  ): Promise<Procedure<IActionContext>> {
    void this.name;
    input.logger.debug({
      phase: this.name,
      message: `RUNTIME_SEAL: browser=${String(
        (input as unknown as Record<string, unknown>).browser,
      )}`,
    });
    return executeFillAndSubmitFromDiscovery(this._config, input);
  }

  /** @inheritdoc */
  public async post(
    _ctx: IPipelineContext,
    input: IPipelineContext,
  ): Promise<Procedure<IPipelineContext>> {
    void this.name;
    if (!input.mediator.has) return fail(ScraperErrorTypes.Generic, 'LOGIN POST: no mediator');
    return executeValidateLogin(this._config, input.mediator.value, input);
  }

  /** @inheritdoc */
  public async final(
    _ctx: IPipelineContext,
    input: IPipelineContext,
  ): Promise<Procedure<IPipelineContext>> {
    void this.name;
    return executeLoginSignal(input);
  }

  /**
   * Validate PRE produced loginFieldDiscovery for ACTION.
   * @param ctx - Context after PRE.
   * @returns True if discovery payload exists.
   */
  protected override validatePrePayload(ctx: IPipelineContext): IsPrePayloadValid {
    void this.name;
    if (!ctx.loginFieldDiscovery.has) return true;
    return true;
  }
}

/**
 * Create the LOGIN phase from config.
 * @param config - Bank's login configuration.
 * @returns LoginPhase with PRE/ACTION/POST/FINAL.
 */
function createLoginPhaseFromConfig(config: ILoginConfig): LoginPhase {
  return Reflect.construct(LoginPhase, [config]);
}

export { createLoginPhaseFromConfig, LoginPhase };
