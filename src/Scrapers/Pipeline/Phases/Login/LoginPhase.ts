/**
 * LOGIN phase — thin orchestration, all logic in Mediator/Login/LoginPhaseActions.
 * PRE:    discover credential form + resolve all fields (checkReadiness + preAction + discovery)
 * ACTION: fill from discovery + submit (no bridge cast, no mediator discovery)
 * POST:   validate OK or error (form errors + traffic wait)
 * FINAL:  prove dashboard loaded → signal to DASHBOARD (cookies + API strategy)
 */

import { ScraperErrorTypes } from '../../../Base/ErrorTypes.js';
import type { ILoginConfig } from '../../../Base/Interfaces/Config/LoginConfig.js';
import type { IPreludeSpec } from '../../Mediator/Elements/PagePrelude.js';
import { PRELUDE_NONE } from '../../Mediator/Elements/PagePrelude.js';
import {
  executeDiscoverForm,
  executeFillAndSubmitFromDiscovery,
  executeLoginSignal,
  executeValidateLogin,
} from '../../Mediator/Login/LoginPhaseActions.js';
import { LOGIN_PRELUDE_POST_TIMEOUT_MS } from '../../Mediator/Timing/TimingConfig.js';
import { BasePhase } from '../../Types/BasePhase.js';
import type { IActionContext, IPipelineContext } from '../../Types/PipelineContext.js';
import type { Procedure } from '../../Types/Procedure.js';
import { fail } from '../../Types/Procedure.js';

/** LOGIN prelude table — POST waits for SPA-ready; others no-op. */
const LOGIN_PRELUDE_TABLE: Record<'PRE' | 'ACTION' | 'POST' | 'FINAL', IPreludeSpec> = {
  PRE: PRELUDE_NONE,
  ACTION: PRELUDE_NONE,
  POST: { level: 'spa', timeoutMs: LOGIN_PRELUDE_POST_TIMEOUT_MS },
  FINAL: PRELUDE_NONE,
};

/** LOGIN phase — BasePhase with PRE/ACTION/POST/FINAL. */
class LoginPhase extends BasePhase {
  public readonly name = 'login' as const;
  private readonly _config: ILoginConfig;
  private readonly _preludeTable = LOGIN_PRELUDE_TABLE;

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
    return executeDiscoverForm(this._config, input);
  }

  /** @inheritdoc */
  public async action(
    _ctx: IActionContext,
    input: IActionContext,
  ): Promise<Procedure<IActionContext>> {
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
    if (!input.mediator.has) return fail(ScraperErrorTypes.Generic, 'LOGIN POST: no mediator');
    return executeValidateLogin(this._config, input.mediator.value, input);
  }

  /** @inheritdoc */
  public async final(
    _ctx: IPipelineContext,
    input: IPipelineContext,
  ): Promise<Procedure<IPipelineContext>> {
    input.logger.debug({ phase: this.name, message: 'login.final' });
    return executeLoginSignal(input);
  }

  /**
   * LOGIN.POST runs after credential submission — banks redirect / mutate
   * to the OTP screen or dashboard. POST needs SPA-ready so it reads a
   * stable URL + DOM, not a transient intermediate. LOGIN.PRE keeps its
   * own direct `waitForDomReady` call (M4.F2.0) — to be migrated to this
   * helper in a follow-up.
   *
   * @param stage - The stage about to execute.
   * @returns SPA prelude for POST; none otherwise.
   */
  protected override prelude(stage: 'PRE' | 'ACTION' | 'POST' | 'FINAL'): IPreludeSpec {
    return this._preludeTable[stage];
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
