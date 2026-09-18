/**
 * ACTION-stage helpers for the ApiDirectCall phase:
 * boot bundle assembly, primeSession + auth installation, and the
 * runApiDirectCallAction entry that orchestrates them.
 */

import { ScraperErrorTypes } from '../../../Base/ErrorTypes.js';
import { some } from '../../Types/Option.js';
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
import type { IApiDirectCallConfig } from './ConfigContracts/index.js';
import {
  createTokenStrategyFromConfig,
  type GenericCreds,
  type IConfigTokenStrategy,
} from './Flow/TokenStrategyFromConfig.js';

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
 * Assemble the boot bundle from an already-normalised context.
 * @param config - API-direct-call config.
 * @param ctx - Context whose credentials are in the bank's wire format.
 * @returns Boot bundle procedure.
 */
function bootFromNormalised(
  config: IApiDirectCallConfig,
  ctx: IPipelineContext,
): Procedure<IBootedAction> {
  const proc = resolveBusStrategy(config, ctx);
  if (!isOk(proc)) return proc;
  const creds = mergeOptionsIntoCreds(ctx);
  return succeed({ ...proc.value, ctx, creds });
}

/**
 * Build the bus + strategy + creds bundle (ACTION-stage boot).
 *
 * <p>Normalisation runs first and is allowed to refuse: a phone the bank's
 * wire format cannot represent ends the run here, before a bus exists and
 * long before anything reaches the network.
 * @param config - API-direct-call config.
 * @param rawCtx - Pipeline context (pre-normalisation).
 * @returns Boot bundle procedure.
 */
function bootApiAction(
  config: IApiDirectCallConfig,
  rawCtx: IPipelineContext,
): Procedure<IBootedAction> {
  const ctxProc = withNormalisedCreds(rawCtx);
  if (!isOk(ctxProc)) return ctxProc;
  return bootFromNormalised(config, ctxProc.value);
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
 * Warn when a stored long-term token was supplied but the cold SMS chain ran
 * anyway.
 *
 * The warm path fails open by design: `TokenResolverBuilder` retries cold so a
 * dead token never breaks a scrape. That resilience is also what hid issue
 * #576 for a year — every run silently sent an SMS while warm start reported
 * success. One warn turns the next occurrence into a one-run diagnosis.
 * @param booted - Booted ACTION bundle.
 * @param isWarm - Whether the last prime actually reused the stored token.
 * @returns true when the degradation warning was emitted.
 */
function warnOnSilentColdFallback(booted: IBootedAction, isWarm: boolean): boolean {
  if (isWarm) return false;
  if (!booted.strategy.hasWarmState(booted.creds)) return false;
  const detail = 'stored long-term token was not accepted; fell back to the full SMS login';
  booted.ctx.logger.warn({ message: `${PHASE_LABEL} ${detail}` });
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
  warnOnSilentColdFallback(booted, isWarm);
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
 * Publish the long-lived re-login handle onto the context.
 *
 * API-direct banks never run the browser LOGIN phase, so this is the only way
 * the artifact reaches `result.persistentOtpToken`. Callers need it to skip the
 * SMS on the next run; without it the warm-start feature has no supported
 * retrieval channel (issue #576).
 * @param ctx - Pipeline context.
 * @param strategy - Token strategy holding the freshest artifact.
 * @returns Context carrying the durable-auth slot when a token exists.
 */
function withDurableAuth(ctx: IPipelineContext, strategy: IConfigTokenStrategy): IPipelineContext {
  const token = strategy.getLatestLongTermToken();
  if (token.length === 0) return ctx;
  return { ...ctx, durableAuth: some({ persistentOtpToken: token }) };
}

/**
 * Finish the ACTION stage once a header exists: record the warm/cold verdict,
 * install auth on the bus, fire the user callback, and publish the durable
 * re-login token onto the context.
 * @param booted - Booted ACTION bundle.
 * @param header - Authorization header value produced by primeSession.
 * @returns Context carrying the durable-auth slot when a token was minted.
 */
async function completePrimedAuth(
  booted: IBootedAction,
  header: string,
): Promise<IPipelineContext> {
  const { bus, strategy, ctx } = booted;
  recordWarmState(booted);
  setBusAuth(bus, strategy, header);
  await invokeAuthFlowComplete(ctx, strategy, header);
  return withDurableAuth(ctx, strategy);
}

/**
 * Run primeSession on the booted bus, then install auth + session context.
 * @param booted - Booted ACTION bundle.
 * @returns Updated context procedure.
 */
async function installPrimedAuth(booted: IBootedAction): Promise<Procedure<IPipelineContext>> {
  registerStrategy(booted);
  const primed = await primeAndCheck(booted.bus);
  if (!isOk(primed)) return primed;
  const published = await completePrimedAuth(booted, primed.value);
  return succeed(published);
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
