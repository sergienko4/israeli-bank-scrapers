/**
 * runTokenStrategyLogin — generic login-phase orchestrator for
 * banks that have a token lifecycle. OneZero and Pepper share
 * 100% of this body (previously duplicated across their *Login.ts
 * files); future banks can reuse it by providing (label, strategy)
 * only. The retry ladder lives entirely inside the mediator
 * (retryOn401 wrapper + TokenResolverBuilder) — the orchestrator
 * just primes the session and installs the initial header.
 */

import type { IPipelineContext } from '../../Types/PipelineContext.js';
import type { Procedure } from '../../Types/Procedure.js';
import { isOk, succeed } from '../../Types/Procedure.js';
import { resolveApiMediator } from './ApiMediatorAccessor.js';
import type { ITokenStrategy } from './ITokenStrategy.js';

/**
 * Register the strategy with the bank's mediator, prime the
 * session via primeInitial, and install the Authorization header
 * verbatim via setRawAuth. On 401 mid-session the mediator auto-
 * refreshes via strategy.primeFresh (retryOn401 wrapper).
 * @param label - Diagnostic label for resolveApiMediator failures.
 * @param strategy - Bank token strategy (generic over TCreds).
 * @param ctx - Pipeline context (mediator populated by executor).
 * @returns Updated context procedure.
 */
async function runTokenStrategyLogin<TCreds>(
  label: string,
  strategy: ITokenStrategy<TCreds>,
  ctx: IPipelineContext,
): Promise<Procedure<IPipelineContext>> {
  const busProc = resolveApiMediator(ctx, label);
  if (!isOk(busProc)) return busProc;
  const bus = busProc.value;
  const creds = ctx.credentials as unknown as TCreds;
  bus.withTokenStrategy(strategy, ctx, creds);
  const primed = await bus.primeSession();
  if (!isOk(primed)) return primed;
  bus.setRawAuth(primed.value);
  return succeed(ctx);
}

export default runTokenStrategyLogin;
export { runTokenStrategyLogin };
