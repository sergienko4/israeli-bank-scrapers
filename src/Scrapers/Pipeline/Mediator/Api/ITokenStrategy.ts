/**
 * ITokenStrategy<TCreds> — the bank-facing port for the token
 * lifecycle. Banks expose THREE primitives:
 *   - primeInitial   cheap path (stored JWT / stored OTP)
 *   - primeFresh     full SMS/OTP flow
 *   - hasWarmState   did caller supply a stored token?
 * ApiMediator bridges strategy → ITokenResolver via
 * buildResolverFromStrategy, which owns the retry ladder.
 * This interface declares ZERO bank-specific types — Rule #11
 * generic architecture (spec.txt §B.7).
 */

import type { ITokenBus } from '../../Types/Domain/TokenBus.js';
import type { ITokenContext } from '../../Types/Domain/TokenContext.js';
import type { Procedure } from '../../Types/Procedure.js';

/**
 * Generic-parameter helper alias for ITokenStrategy callers — a synonym
 * for `Promise<Procedure<string>>` that documents the contract carried
 * by primeInitial / primeFresh: the full Authorization header VALUE
 * (raw JWT or "Bearer X"), wrapped in the project's Result Procedure.
 */
type TokenPrimeProcedure = Promise<Procedure<string>>;

/**
 * Bank token-lifecycle port. Each method returns a
 * `TokenPrimeProcedure` whose payload is the full Authorization header
 * value installed verbatim by ApiMediator via `setRawAuth`. Methods
 * MUST NOT throw — exceptions are caught at the mediator boundary.
 */
interface ITokenStrategy<TCreds> {
  readonly name: string;
  primeInitial(bus: ITokenBus, ctx: ITokenContext, creds: TCreds): TokenPrimeProcedure;
  primeFresh(bus: ITokenBus, ctx: ITokenContext, creds: TCreds): TokenPrimeProcedure;
  hasWarmState(creds: TCreds): boolean;
}

export type { ITokenStrategy, TokenPrimeProcedure };
