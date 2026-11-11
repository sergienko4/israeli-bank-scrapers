/**
 * ACTION-stage helpers for the ApiDirectCall phase:
 * boot bundle assembly, primeSession + auth installation, and the
 * runApiDirectCallAction entry that orchestrates them.
 */

import type { IDurableAuthState } from '../../Types/Domain/DurableAuthState.js';
import { some } from '../../Types/Option.js';
import { redactSensitiveEnum } from '../../Types/PiiRedactor.js';
import type { IPipelineContext } from '../../Types/PipelineContext.js';
import type { Procedure } from '../../Types/Procedure.js';
import { isOk, succeed } from '../../Types/Procedure.js';
import type { IApiMediator } from '../Api/ApiMediator.js';
import { resolveApiMediator } from '../Api/ApiMediatorAccessor.js';
import { invokeAuthFlowComplete } from './ApiDirectCallActions.callback.js';
import { withNormalisedCreds } from './ApiDirectCallActions.phone.js';
import { mergeOptionsIntoCreds } from './ApiDirectCallActions.pre.js';
import { applyAuthPolicy, primeAndCheck } from './ApiDirectCallActions.prime.js';
import { makeRecoveryHook } from './ApiDirectCallActions.recovery.js';
import {
  COLD_FALLBACK_STALE,
  COLD_FALLBACK_WARM_FAILED,
  coldFallbackDetail,
  PHASE_LABEL,
} from './ApiDirectCallActions.shared.js';
import { createContextStrategy } from './ApiDirectCallActions.strategy.js';
import type { IApiDirectCallConfig } from './ConfigContracts/index.js';
import type { IAuthModePolicy } from './Flow/AuthModePolicy.js';
import type {
  GenericCreds,
  IConfigTokenStrategy,
} from './Flow/Lifecycle/TokenStrategyFromConfig.js';
import { projectSessionCarry } from './SessionCarryProjection.js';

/** Booted ACTION bundle — bus, strategy, context, creds, fallback and allowlist. */
interface IBootedAction {
  readonly bus: IApiMediator;
  readonly strategy: IConfigTokenStrategy;
  readonly ctx: IPipelineContext;
  readonly creds: GenericCreds;
  readonly fallbackDetail: string;
  readonly sessionCarry?: readonly string[];
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
 * @returns Procedure containing bus + strategy, or an option-validation failure.
 */
function resolveBusStrategy(
  config: IApiDirectCallConfig,
  ctx: IPipelineContext,
): Procedure<IBusStrategy> {
  const busProc = resolveApiMediator(ctx, PHASE_LABEL);
  if (!isOk(busProc)) return busProc;
  const stratProc = createContextStrategy(config, ctx);
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
  const fallbackDetail = coldFallbackDetail(config);
  return succeed({ ...proc.value, ctx, creds, fallbackDetail, sessionCarry: config.sessionCarry });
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
 * Install raw auth + the projected session context on the bus.
 * @param booted - Booted ACTION bundle (bus, carry source, allowlist).
 * @param header - Authorization header value to install.
 * @returns true for chaining.
 */
function setBusAuth(booted: IBootedAction, header: string): true {
  const { bus, strategy, sessionCarry } = booted;
  bus.setRawAuth(header);
  const snapshot = strategy.getLatestCarrySnapshot();
  const session = projectSessionCarry(snapshot, sessionCarry);
  bus.setSessionContext(session);
  return true;
}

/**
 * Name the cause that matches what actually happened to the stored seed.
 *
 * <p>Only the local-freshness rejection is knowable here. Everything else the
 * cold retry swallows — refusal, timeout, transport — so the warm attempt's
 * error tag is reported rather than a guess at which one it was. (A WAF block
 * is terminal and never reaches the cold retry.)
 * The tag is passed through `redactSensitiveEnum` because password-class tags
 * are themselves credential metadata. An absent tag is a defensive default —
 * `fail()` always carries a `ScraperErrorTypes` value — so the clause degrades
 * to the bare neutral wording rather than printing an empty parenthesis.
 * @param strategy - The strategy that primed the session.
 * @returns Cause clause for the fallback warning.
 */
function pickFallbackCause(strategy: IBootedAction['strategy']): string {
  if (strategy.warmSeedRejectedLocally()) return COLD_FALLBACK_STALE;
  const failureType = strategy.warmAttemptFailureType();
  if (failureType.length === 0) return COLD_FALLBACK_WARM_FAILED;
  const safeType = redactSensitiveEnum(failureType);
  return `${COLD_FALLBACK_WARM_FAILED} (${safeType})`;
}

/**
 * Whether the stored seed degraded this prime: refused by the local gate, or
 * sent and failed. Retry eligibility (`hasWarmState`) cannot answer this — a
 * locally refused seed is ineligible for a retry yet still forced a cold login.
 * @param strategy - The strategy that primed the session.
 * @returns True when a supplied seed did not carry the session.
 */
function didStoredSeedDegrade(strategy: IBootedAction['strategy']): boolean {
  if (strategy.warmSeedRejectedLocally()) return true;
  return strategy.warmAttemptFailureType().length > 0;
}

/**
 * Warn when a stored long-term token was supplied but the cold login ran
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
  if (!didStoredSeedDegrade(booted.strategy)) return false;
  const cause = pickFallbackCause(booted.strategy);
  const detail = `${cause}; ${booted.fallbackDetail}`;
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
  const { bus, strategy, ctx, creds, fallbackDetail, sessionCarry } = booted;
  bus.withTokenStrategy(strategy, ctx, creds);
  const hook = makeRecoveryHook({ bus, ctx, strategy, fallbackDetail, sessionCarry });
  return bus.withRecoveryHook?.(hook) ?? false;
}

/**
 * Build the durable-auth slot as a live read of the strategy.
 *
 * <p>A getter keeps the published shape a plain `string` property — the
 * data contract `PipelineResult` already reads — while resolving it at
 * read time, so whichever token the strategy holds when the result is
 * built is the one the caller is handed.
 * @param strategy - Token strategy holding the freshest artifact.
 * @returns Durable-auth state backed by the strategy.
 */
function liveDurableAuth(strategy: IConfigTokenStrategy): IDurableAuthState {
  return {
    /**
     * Resolve the durable token at read time.
     * @returns The freshest long-term token the strategy holds.
     */
    get persistentOtpToken(): string {
      return strategy.getLatestLongTermToken();
    },
  };
}

/**
 * Publish the long-lived re-login handle onto the context.
 *
 * API-direct banks never run the browser LOGIN phase, so this is the only way
 * the artifact reaches `result.persistentOtpToken`. Callers need it to skip the
 * SMS on the next run; without it the warm-start feature has no supported
 * retrieval channel (issue #576).
 *
 * <p>The slot is a live view of the strategy, not a copy. A warm session can
 * be revoked mid-run: `ApiMediator` then recovers cold and the strategy mints
 * a replacement. A value copied here would leave `result.persistentOtpToken`
 * holding the dead token, and callers are told to overwrite their stored copy
 * from every result — so the snapshot would actively destroy the good token
 * and force an SMS on the next run, which is issue #576 all over again.
 * @param ctx - Pipeline context.
 * @param strategy - Token strategy holding the freshest artifact.
 * @returns Context carrying the durable-auth slot when a token exists.
 */
function withDurableAuth(ctx: IPipelineContext, strategy: IConfigTokenStrategy): IPipelineContext {
  const token = strategy.getLatestLongTermToken();
  if (token.length === 0) return ctx;
  const liveView = liveDurableAuth(strategy);
  return { ...ctx, durableAuth: some(liveView) };
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
  const { strategy, ctx } = booted;
  recordWarmState(booted);
  setBusAuth(booted, header);
  await invokeAuthFlowComplete(ctx, strategy, header);
  return withDurableAuth(ctx, strategy);
}

/**
 * Run primeSession on the booted bus, then install auth + session context.
 * @param booted - Booted ACTION bundle.
 * @param policy - The bank's auth-mode policy.
 * @returns Updated context procedure.
 */
async function installPrimedAuth(
  booted: IBootedAction,
  policy: IAuthModePolicy,
): Promise<Procedure<IPipelineContext>> {
  registerStrategy(booted);
  const primed = await primeAndCheck(booted.bus, policy);
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
  const policy = applyAuthPolicy(bootProc.value.bus, config);
  return installPrimedAuth(bootProc.value, policy);
}

export default runApiDirectCallAction;

export { runApiDirectCallAction };
