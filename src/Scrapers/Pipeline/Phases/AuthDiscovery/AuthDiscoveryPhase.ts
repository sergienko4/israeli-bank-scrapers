/**
 * AUTH-DISCOVERY phase — thin orchestration, all logic in Mediator.
 *
 * Mission 1 of the CI quality hardening plan. Sits between OTP-FILL
 * (when present) or LOGIN (when no OTP) and ACCOUNT-RESOLVE; auto-
 * bound by the builder for every browser bank.
 *
 * PRE:    inventory snapshot of network captures + cookie names.
 * ACTION: sealed pass-through (no mediator on `IActionContext`).
 * POST:   collects auth channels + dashboard reveal + cookie audit;
 *         commits `ctx.authDiscovery` or fails loud
 *         `AUTH_DISCOVERY_SESSION_INVALID` on cookies=0.
 * FINAL:  emits the `auth-discovery.committed` telemetry event.
 */

import {
  executeAuthDiscoveryAction,
  executeAuthDiscoveryFinal,
  executeAuthDiscoveryPost,
  executeAuthDiscoveryPre,
} from '../../Mediator/AuthDiscovery/AuthDiscoveryActions.js';
import { BasePhase } from '../../Types/BasePhase.js';
import type { IActionContext, IPipelineContext } from '../../Types/PipelineContext.js';
import type { Procedure } from '../../Types/Procedure.js';

/** AUTH-DISCOVERY phase — BasePhase with PRE/ACTION/POST/FINAL. */
class AuthDiscoveryPhase extends BasePhase {
  public readonly name = 'auth-discovery' as const;

  /** @inheritdoc */
  public async pre(
    _ctx: IPipelineContext,
    input: IPipelineContext,
  ): Promise<Procedure<IPipelineContext>> {
    input.logger.debug({ phase: this.name, message: 'auth-discovery.pre' });
    return executeAuthDiscoveryPre(input);
  }

  /** @inheritdoc */
  public async action(
    _ctx: IActionContext,
    input: IActionContext,
  ): Promise<Procedure<IActionContext>> {
    input.logger.debug({ phase: this.name, message: 'auth-discovery.action' });
    return executeAuthDiscoveryAction(input);
  }

  /** @inheritdoc */
  public async post(
    _ctx: IPipelineContext,
    input: IPipelineContext,
  ): Promise<Procedure<IPipelineContext>> {
    input.logger.debug({ phase: this.name, message: 'auth-discovery.post' });
    return executeAuthDiscoveryPost(input);
  }

  /** @inheritdoc */
  public async final(
    _ctx: IPipelineContext,
    input: IPipelineContext,
  ): Promise<Procedure<IPipelineContext>> {
    input.logger.debug({ phase: this.name, message: 'auth-discovery.final' });
    return executeAuthDiscoveryFinal(input);
  }
}

/**
 * Create the AUTH-DISCOVERY phase instance.
 * @returns AuthDiscoveryPhase.
 */
function createAuthDiscoveryPhase(): AuthDiscoveryPhase {
  return Reflect.construct(AuthDiscoveryPhase, []);
}

export { AuthDiscoveryPhase, createAuthDiscoveryPhase };
