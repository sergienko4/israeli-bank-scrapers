/**
 * ITokenStrategy<TCreds> — the bank-facing port for the token
 * lifecycle. Banks expose THREE primitives:
 *   - primeInitial   cheap path (stored JWT / stored OTP)
 *   - primeFresh     full SMS/OTP flow
 *   - hasWarmState   may a failed primeInitial retry via primeFresh?
 * Optional mayEscalateWarmFailure narrows which failures may fall back;
 * primeRecover re-grants a rejected session for whole-scrape recovery.
 * ApiMediator bridges strategy → ITokenResolver via
 * buildResolverFromStrategy, which owns the retry ladder.
 * This interface declares ZERO bank-specific types — Rule #11
 * generic architecture (spec.txt §B.7).
 */

import type { ITokenBus } from '../../Types/Domain/TokenBus.js';
import type { ITokenContext } from '../../Types/Domain/TokenContext.js';
import type { IProcedureFailure, Procedure } from '../../Types/Procedure.js';

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
  /**
   * Whether this failed primeInitial outcome may fall back to primeFresh.
   * Asked only after the builder's own checks (not WAF, warm state present);
   * absent, every such failure may.
   */
  mayEscalateWarmFailure?(failure: IProcedureFailure): boolean;
  /**
   * Re-grant a session the bank rejected mid-scrape, before the whole scrape
   * re-runs. Absent, recovery runs primeFresh through `refresh`.
   */
  primeRecover?(bus: ITokenBus, ctx: ITokenContext, creds: TCreds): TokenPrimeProcedure;
}

export type { ITokenStrategy, TokenPrimeProcedure };
