/**
 * Method-bundle builder for the ApiMediator warm-session self-heal surface.
 *
 * Mirrors the `bindXxx` + `buildXxx` pattern in `ApiMediator.builders.ts`:
 * each bind curries the mediator-state capture into a bound callable, and
 * `buildRecoveryMethods` gathers them into the `IRecoveryMethods` bundle that
 * `assembleMediator` folds onto the shell.
 */

import type { Procedure } from '../../Types/Procedure.js';
import { recoverSessionOp } from './ApiMediator.retry.js';
import { getSessionWarmOp, setSessionWarmOp } from './ApiMediator.state.js';
import type { IMediatorState, IRecoveryMethods } from './ApiMediator.types.js';

/**
 * Bind the warm-flag setter to the given mediator state.
 * @param state - Mediator state.
 * @returns Bound `setSessionWarm` callable.
 */
function bindSetSessionWarm(state: IMediatorState): IRecoveryMethods['setSessionWarm'] {
  return (value: boolean): boolean => setSessionWarmOp(state, value);
}

/**
 * Bind the warm-flag getter to the given mediator state.
 * @param state - Mediator state.
 * @returns Bound `wasSessionWarm` callable.
 */
function bindWasSessionWarm(state: IMediatorState): IRecoveryMethods['wasSessionWarm'] {
  return (): boolean => getSessionWarmOp(state);
}

/**
 * Bind the cold session-recovery invocation to the given mediator state.
 * @param state - Mediator state.
 * @returns Bound `recoverSession` callable.
 */
function bindRecoverSession(state: IMediatorState): IRecoveryMethods['recoverSession'] {
  return async (): Promise<Procedure<string>> => recoverSessionOp(state);
}

/**
 * Build the warm-session self-heal method bundle.
 * @param state - Mediator state.
 * @returns Recovery methods.
 */
function buildRecoveryMethods(state: IMediatorState): IRecoveryMethods {
  return {
    setSessionWarm: bindSetSessionWarm(state),
    wasSessionWarm: bindWasSessionWarm(state),
    recoverSession: bindRecoverSession(state),
  };
}

export default buildRecoveryMethods;

export { buildRecoveryMethods };
