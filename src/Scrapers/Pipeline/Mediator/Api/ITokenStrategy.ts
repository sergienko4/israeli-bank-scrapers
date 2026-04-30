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

import type { IPipelineContext } from '../../Types/PipelineContext.js';
import type { Procedure } from '../../Types/Procedure.js';
import type { IApiMediator } from './ApiMediator.js';
import type { AuthorizationHeaderValue, TokenResolverName } from './ITokenResolver.js';

/** Predicate flag — TYPE alias satisfies Rule #15 (no bare boolean returns). */
type WarmStateFlag = boolean;

/**
 * Bank token-lifecycle port. Each method returns
 * `Procedure<AuthorizationHeaderValue>`; the string is installed
 * verbatim by ApiMediator via `setRawAuth`. Methods MUST NOT
 * throw — exceptions are caught at the mediator boundary.
 */
interface ITokenStrategy<TCreds> {
  readonly name: TokenResolverName;
  primeInitial(
    bus: IApiMediator,
    ctx: IPipelineContext,
    creds: TCreds,
  ): Promise<Procedure<AuthorizationHeaderValue>>;
  primeFresh(
    bus: IApiMediator,
    ctx: IPipelineContext,
    creds: TCreds,
  ): Promise<Procedure<AuthorizationHeaderValue>>;
  hasWarmState(creds: TCreds): WarmStateFlag;
}

export type { ITokenStrategy, WarmStateFlag };
