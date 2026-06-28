/**
 * ACTION-stage helpers for the ApiDirectCall phase:
 * boot bundle assembly, primeSession + auth installation, and the
 * runApiDirectCallAction entry that orchestrates them.
 */

import { ScraperErrorTypes } from '../../../Base/ErrorTypes.js';
import type { IPipelineContext } from '../../Types/PipelineContext.js';
import type { Procedure } from '../../Types/Procedure.js';
import { fail, isOk, succeed } from '../../Types/Procedure.js';
import type { IApiMediator } from '../Api/ApiMediator.js';
import { resolveApiMediator } from '../Api/ApiMediatorAccessor.js';
import { invokeAuthFlowComplete } from './ApiDirectCallActions.callback.js';
import { withNormalisedCreds } from './ApiDirectCallActions.phone.js';
import { mergeOptionsIntoCreds } from './ApiDirectCallActions.pre.js';
import { makeRecoveryHook } from './ApiDirectCallActions.recovery.js';
import { PHASE_LABEL, safeInvoke } from './ApiDirectCallActions.shared.js';
import {
  createTokenStrategyFromConfig,
  type GenericCreds,
  type IConfigTokenStrategy,
} from './Flow/TokenStrategyFromConfig.js';
import type { IApiDirectCallConfig } from './IApiDirectCallConfig.js';

/** Booted ACTION bundle — bus + strategy + ctx + creds. */
interface IBootedAction {
  readonly bus: IApiMediator;
  readonly strategy: IConfigTokenStrategy;
  readonly ctx: IPipelineContext;
  readonly creds: GenericCreds;
}

/** Pair of (bus, strategy) — the two procedures we resolve before booting. */
interface IBusStrategy {
  readonly bus: IApiMediator;
  readonly strategy: IConfigTokenStrategy;
}

/**
 * Resolve the bus and strategy procedures for the ACTION boot bundle.
 * @param config - API-direct-call config.
 * @param ctx - Normalised pipeline context.
 * @returns Procedure containing bus + strategy.
 */
function resolveBusStrategy(
  config: IApiDirectCallConfig,
  ctx: IPipelineContext,
): Procedure<IBusStrategy> {
  const busProc = resolveApiMediator(ctx, PHASE_LABEL);
  if (!isOk(busProc)) return busProc;
  const stratProc = createTokenStrategyFromConfig({ config });
  if (!isOk(stratProc)) return stratProc;
  return succeed({ bus: busProc.value, strategy: stratProc.value });
}

/**
 * Build the bus + strategy + creds bundle (ACTION-stage boot).
 * @param config - API-direct-call config.
 * @param rawCtx - Pipeline context (pre-normalisation).
 * @returns Boot bundle procedure.
 */
function bootApiAction(
  config: IApiDirectCallConfig,
  rawCtx: IPipelineContext,
): Procedure<IBootedAction> {
  const ctx = withNormalisedCreds(rawCtx);
  const proc = resolveBusStrategy(config, ctx);
  if (!isOk(proc)) return proc;
  const creds = mergeOptionsIntoCreds(ctx);
  return succeed({ ...proc.value, ctx, creds });
}

/**
 * Standard empty-header failure builder.
 * @returns Procedure failure for empty primeSession result.
 */
function emptyHeaderFail<T>(): Procedure<T> {
  return fail(ScraperErrorTypes.Generic, `${PHASE_LABEL} ACTION empty header`);
}

/**
 * Run primeSession with safeInvoke + empty-header guard.
 * @param bus - ApiMediator.
 * @returns Header string procedure.
 */
async function primeAndCheck(bus: IApiMediator): Promise<Procedure<string>> {
  const primed = await safeInvoke('ACTION primeSession', () => bus.primeSession());
  if (!isOk(primed)) return primed;
  if (primed.value.length === 0) return emptyHeaderFail();
  return primed;
}

/**
 * Install raw auth + session-context on the bus.
 * @param bus - ApiMediator.
 * @param strategy - Token strategy (for carry snapshot).
 * @param header - Authorization header value to install.
 * @returns true for chaining.
 */
function setBusAuth(bus: IApiMediator, strategy: IConfigTokenStrategy, header: string): true {
  bus.setRawAuth(header);
  const snapshot = strategy.getLatestCarrySnapshot();
  bus.setSessionContext(snapshot);
  return true;
}

/**
 * Record whether the strategy's LAST prime actually reused a cached warm
 * token (vs ran the cold OTP flow) onto the bus. Reads the post-prime
 * `lastPrimeWasWarm` so the flag reflects the path that produced the
 * final token — not mere cached-token presence (which a stale/expired
 * seed satisfies even though it falls back to the cold flow).
 * @param booted - Booted ACTION bundle.
 * @returns The recorded warm-state flag.
 */
function recordWarmState(booted: IBootedAction): boolean {
  const isWarm = booted.strategy.lastPrimeWasWarm();
  booted.bus.setSessionWarm(isWarm);
  return isWarm;
}

/**
 * Register the token strategy and install the post-recovery re-cache hook.
 * @param booted - Booted ACTION bundle.
 * @returns True once the strategy + hook are registered.
 */
function registerStrategy(booted: IBootedAction): boolean {
  const { bus, strategy, ctx, creds } = booted;
  bus.withTokenStrategy(strategy, ctx, creds);
  const hook = makeRecoveryHook({ bus, ctx, strategy });
  return bus.withRecoveryHook?.(hook) ?? false;
}

/**
 * Run primeSession on the booted bus, install auth + session context.
 * @param booted - Booted ACTION bundle.
 * @returns Updated context procedure.
 */
async function installPrimedAuth(booted: IBootedAction): Promise<Procedure<IPipelineContext>> {
  const { bus, strategy, ctx } = booted;
  registerStrategy(booted);
  const primed = await primeAndCheck(bus);
  if (!isOk(primed)) return primed;
  recordWarmState(booted);
  setBusAuth(bus, strategy, primed.value);
  await invokeAuthFlowComplete(ctx, strategy, primed.value);
  return succeed(ctx);
}

/**
 * ACTION stage — normalise credentials, build strategy from config,
 * register, prime, install.
 * @param config - API-direct-call config.
 * @param rawCtx - Pipeline context (pre-normalisation).
 * @returns Updated context, or fail when prime fails.
 */
async function runApiDirectCallAction(
  config: IApiDirectCallConfig,
  rawCtx: IPipelineContext,
): Promise<Procedure<IPipelineContext>> {
  const bootProc = bootApiAction(config, rawCtx);
  if (!isOk(bootProc)) return bootProc;
  return installPrimedAuth(bootProc.value);
}

export default runApiDirectCallAction;

export { runApiDirectCallAction };
