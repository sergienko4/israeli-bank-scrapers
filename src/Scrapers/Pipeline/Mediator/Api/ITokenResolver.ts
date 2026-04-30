/**
 * ITokenResolver — the pluggable port on ApiMediator that owns a bank's
 * token lifecycle. Banks construct a concrete resolver during LOGIN phase
 * with their own credentials + bus + context baked in, then register it
 * via `ApiMediator.withTokenResolver(r)`. ApiMediator calls:
 *
 *   - `resolve()` once when priming a session.
 *   - `refresh()` exactly once on any 401 response to rotate the token.
 *
 * The port declares ZERO bank-specific types — Rule #11 (generic
 * architecture). Concrete resolvers live under `Banks/<Bank>/login/`.
 *
 * Contract (spec.txt §1):
 *   - Each method returns `Procedure<AuthorizationHeaderValue>`.
 *   - The returned string is the full Authorization header VALUE
 *     (`"Bearer <jwt>"` or `"<jwt>"` per bank convention). ApiMediator
 *     installs it verbatim via `setRawAuth`.
 *   - Empty-string returns MUST be treated as failure by callers.
 *   - Methods MUST NOT throw; unexpected exceptions are caught at the
 *     ApiMediator boundary and converted to `Procedure` failures.
 */

import { ScraperErrorTypes } from '../../../Base/ErrorTypes.js';
import type { Procedure } from '../../Types/Procedure.js';
import { fail } from '../../Types/Procedure.js';

/** Non-empty Authorization header VALUE (raw JWT or "Bearer X"). */
type AuthorizationHeaderValue = string;

/** Human-readable resolver identity — for logs + error diagnostics. */
type TokenResolverName = string;

/**
 * Token-lifecycle port. ApiMediator depends on this interface; banks
 * implement it under their own namespace. Each concrete resolver closes
 * over the context + credentials it needs — the port deliberately takes
 * no arguments.
 */
interface ITokenResolver {
  readonly name: TokenResolverName;
  resolve(): Promise<Procedure<AuthorizationHeaderValue>>;
  refresh(): Promise<Procedure<AuthorizationHeaderValue>>;
}

/** Diagnostic message used by NullResolver on both methods. */
const NULL_RESOLVER_MESSAGE = 'no token resolver registered';

/**
 * NullResolver.resolve — uniform failure so ApiMediator's control flow
 * doesn't need an "is resolver present?" branch.
 * @returns Generic failure procedure.
 */
async function nullResolverResolve(): Promise<Procedure<AuthorizationHeaderValue>> {
  await Promise.resolve();
  return fail(ScraperErrorTypes.Generic, NULL_RESOLVER_MESSAGE);
}

/**
 * NullResolver.refresh — matches resolve semantic.
 * @returns Generic failure procedure.
 */
async function nullResolverRefresh(): Promise<Procedure<AuthorizationHeaderValue>> {
  await Promise.resolve();
  return fail(ScraperErrorTypes.Generic, NULL_RESOLVER_MESSAGE);
}

/**
 * Default sentinel. When ApiMediator has no real resolver, this one
 * keeps the control flow uniform: a call to resolve or refresh returns
 * a Procedure failure, NOT an exception.
 */
const NULL_RESOLVER: ITokenResolver = {
  name: 'NullResolver',
  resolve: nullResolverResolve,
  refresh: nullResolverRefresh,
};

export type { AuthorizationHeaderValue, ITokenResolver, TokenResolverName };
export { NULL_RESOLVER };
