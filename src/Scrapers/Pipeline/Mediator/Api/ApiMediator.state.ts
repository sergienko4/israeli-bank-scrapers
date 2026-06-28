/**
 * Mutable mediator-state operations: auth/session storage, resolver
 * registration, and session priming.
 */

import type { Procedure } from '../../Types/Procedure.js';
import type {
  IMediatorState,
  IWithTokenStrategyOpArgs,
  RecoveredHook,
  SessionContext,
  WasResolverSet,
} from './ApiMediator.types.js';
import type { ITokenResolver } from './ITokenResolver.js';
import { NULL_RESOLVER } from './ITokenResolver.js';
import { buildResolverFromStrategy } from './TokenResolverBuilder.js';

/**
 * Construct the initial frozen-snapshot state for a fresh mediator.
 * @returns Initial state record.
 */
function makeInitialMediatorState(): IMediatorState {
  return {
    rawAuth: '',
    resolver: NULL_RESOLVER,
    sessionContext: Object.freeze({}),
    sessionWarm: false,
  };
}

/**
 * Store an Authorization header verbatim on the mediator state.
 * @param state - Mediator state.
 * @param headerValue - Full Authorization header value.
 * @returns True once stored.
 */
function setRawAuthOp(state: IMediatorState, headerValue: string): boolean {
  state.rawAuth = headerValue;
  return true;
}

/**
 * Install the post-login session-context snapshot (freezes a copy).
 * @param state - Mediator state.
 * @param ctx - Session-context snapshot.
 * @returns True once stored.
 */
function setSessionContextOp(state: IMediatorState, ctx: SessionContext): boolean {
  state.sessionContext = Object.freeze({ ...ctx });
  return true;
}

/**
 * Return the stored session-context snapshot (frozen).
 * @param state - Mediator state.
 * @returns Session-context snapshot.
 */
function getSessionContextOp(state: IMediatorState): SessionContext {
  return state.sessionContext;
}

/**
 * Record whether the active session was primed from a cached warm token.
 * @param state - Mediator state.
 * @param value - True when a warm (cached) token seeded the session.
 * @returns The stored value (echoed for caller convenience).
 */
function setSessionWarmOp(state: IMediatorState, value: boolean): boolean {
  state.sessionWarm = value;
  return value;
}

/**
 * Return whether the active session was primed from a cached warm token.
 * @param state - Mediator state.
 * @returns True when the session is warm-seeded.
 */
function getSessionWarmOp(state: IMediatorState): boolean {
  return state.sessionWarm;
}

/**
 * Register the post-recovery re-cache hook on the mediator state.
 * @param state - Mediator state.
 * @param hook - Callback fired with the new header after a successful recovery.
 * @returns True once stored.
 */
function setRecoveryHookOp(state: IMediatorState, hook: RecoveredHook): boolean {
  state.onRecovered = hook;
  return true;
}

/**
 * Convenience wrapper — stores a `Bearer <token>` Authorization header.
 * @param state - Mediator state.
 * @param token - Opaque bearer value.
 * @returns True once stored.
 */
function setBearerOp(state: IMediatorState, token: string): boolean {
  return setRawAuthOp(state, `Bearer ${token}`);
}

/**
 * Register a concrete token resolver. Replaces any prior resolver.
 * @param state - Mediator state.
 * @param resolver - Bank-specific resolver.
 * @returns True once registered.
 */
function withTokenResolverOp(state: IMediatorState, resolver: ITokenResolver): WasResolverSet {
  state.resolver = resolver;
  return true;
}

/**
 * Register a bank token strategy bound via `buildResolverFromStrategy`.
 * @param args - Strategy + context + creds bundle.
 * @returns True once registered.
 */
function withTokenStrategyOp<TCreds>(args: IWithTokenStrategyOpArgs<TCreds>): WasResolverSet {
  const { state, self, strategy, ctx, creds } = args;
  state.resolver = buildResolverFromStrategy({ strategy, bus: self, ctx, creds });
  return true;
}

/**
 * Prime the session via the currently registered resolver.
 * @param state - Mediator state.
 * @returns Header-value procedure.
 */
async function primeSessionOp(state: IMediatorState): Promise<Procedure<string>> {
  return state.resolver.resolve();
}

export {
  getSessionContextOp,
  getSessionWarmOp,
  makeInitialMediatorState,
  primeSessionOp,
  setBearerOp,
  setRawAuthOp,
  setRecoveryHookOp,
  setSessionContextOp,
  setSessionWarmOp,
  withTokenResolverOp,
  withTokenStrategyOp,
};
