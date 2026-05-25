/**
 * ApiDirectCallActions — PRE / ACTION / POST stage helpers for the
 * API-DIRECT-CALL phase driven by an IApiDirectCallConfig literal.
 * Zero bank knowledge.
 *
 * PRE    emit a LoginKind hint based on config.jwtClaims + creds
 * ACTION build ITokenStrategy from config → register → primeSession
 * POST   run config.probe (queryTag / urlTag) once
 */

import { ScraperErrorTypes } from '../../../Base/ErrorTypes.js';
import type { IAuthFlowInfo } from '../../../Base/Interface.js';
import { toErrorMessage } from '../../Types/ErrorUtils.js';
import type { LoginKind } from '../../Types/LoginKind.js';
import type { IPipelineContext } from '../../Types/PipelineContext.js';
import type { Procedure } from '../../Types/Procedure.js';
import { fail, isOk, succeed } from '../../Types/Procedure.js';
import type { IApiMediator } from '../Api/ApiMediator.js';
import { resolveApiMediator } from '../Api/ApiMediatorAccessor.js';
import { formatPhoneNumber } from '../Credentials/PhoneFormatter.js';
import {
  createTokenStrategyFromConfig,
  type GenericCreds,
  type IConfigTokenStrategy,
} from './Flow/TokenStrategyFromConfig.js';
import type { IApiDirectCallConfig, IProbeConfig } from './IApiDirectCallConfig.js';
import { isJwtFresh } from './Jwt/GenericJwtClaims.js';

/** ScraperOptions callback signature — surfaced at the bank surface. */
type IAuthFlowCallback = (info: IAuthFlowInfo) => void | Promise<void>;

/** Diagnostic label for the phase — appears in error messages. */
const PHASE_LABEL = 'api-direct-call';

/**
 * Convert thrown errors into Procedure failures — same shape as the
 * plugin-based safeInvoke.
 * @param label - Short context for error diagnostics.
 * @param fn - Async function to invoke.
 * @returns Procedure resolved from the call.
 */
async function safeInvoke<T>(
  label: string,
  fn: () => Promise<Procedure<T>>,
): Promise<Procedure<T>> {
  try {
    return await fn();
  } catch (error) {
    const message = toErrorMessage(error as Error);
    return fail(ScraperErrorTypes.Generic, `${PHASE_LABEL} ${label} threw: ${message}`);
  }
}

/**
 * Pure forensic — classify the login path based on warmStart + jwtClaims.
 * @param config - API-direct-call config.
 * @param creds - Caller credentials.
 * @returns LoginKind hint.
 */
function classifyLoginKind(config: IApiDirectCallConfig, creds: GenericCreds): LoginKind {
  if (config.warmStart === undefined) return 'sms-otp';
  const stored = creds[config.warmStart.credsField];
  if (typeof stored !== 'string' || stored.length === 0) return 'sms-otp';
  if (config.jwtClaims === undefined) return 'stored-jwt-stale';
  if (isJwtFresh(stored, config.jwtClaims)) return 'stored-jwt-fresh';
  return 'stored-jwt-stale';
}

/**
 * PRE stage — pure classification, no network.
 * @param config - API-direct-call config.
 * @param ctx - Pipeline context.
 * @returns Propagated PRE result.
 */
async function runApiDirectCallPre(
  config: IApiDirectCallConfig,
  ctx: IPipelineContext,
): Promise<Procedure<IPipelineContext>> {
  await Promise.resolve();
  const creds = mergeOptionsIntoCreds(ctx);
  const kind = classifyLoginKind(config, creds);
  ctx.logger.debug({ message: `[api-direct-call] PRE kind='${kind}' config-driven` });
  return succeed(ctx);
}

/**
 * Merge ScraperOptions into credentials so generic config refs can
 * read options-scope fields (e.g. options.otpCodeRetriever) without
 * knowing the distinction. Options override creds — matches
 * pickRetriever semantics (ApiOtpRetriever.ts).
 * @param ctx - Pipeline context.
 * @returns Combined record for ApiDirectCall token flows.
 */
function mergeOptionsIntoCreds(ctx: IPipelineContext): GenericCreds {
  const opts = ctx.options as unknown as Record<string, unknown>;
  const creds = ctx.credentials as unknown as Record<string, unknown>;
  return { ...creds, ...opts };
}

/**
 * Rewrite `ctx.credentials.phoneNumber` into the bank's wire format
 * declared in `PipelineBankConfig.headless.phoneNumberFormat`.
 *
 * Phone normalisation runs HERE rather than in the Core context
 * factory so Core stays free of credential transforms (Rule P7:
 * mediator owns external-side prep). Downstream phases (scrape) see
 * the rewritten phoneNumber via the returned ctx.
 *
 * Format failures are logged but do NOT throw — the pipeline keeps
 * the caller's raw input so downstream validation surfaces the error
 * in its own Procedure failure.
 * @param ctx - Pipeline context.
 * @returns Ctx with credentials.phoneNumber in wire format (or ctx
 *   verbatim when the bank doesn't declare a format / no phoneNumber).
 */
/**
 * PII-safe shape descriptor for a phone string. Captures structural
 * attributes (length, leading digit, separator presence) without
 * logging the digits themselves.
 * @param raw - Raw phone string.
 * @returns Structure descriptor object.
 */
function phoneShape(raw: string): Readonly<Record<string, unknown>> {
  return {
    len: raw.length,
    startsWith972: raw.startsWith('972'),
    hasDash: raw.includes('-'),
    hasPlus: raw.includes('+'),
    hasSpace: raw.includes(' '),
    leadingZero: raw.startsWith('0'),
  };
}

/**
 * Rewrite `ctx.credentials.phoneNumber` into the bank's wire format
 * declared by `PipelineBankConfig.headless.phoneNumberFormat`.
 *
 * Phone normalisation runs in the ACTION-stage mediator (Rule P7 —
 * mediator owns external-side prep), so Core stays free of
 * credential transforms. Downstream phases (scrape) see the
 * rewritten phoneNumber via the returned ctx.
 *
 * Format failures are LOGGED (PII-safe shape descriptor — no digits)
 * but do NOT throw; the pipeline keeps the caller's raw input so
 * downstream validation surfaces a clearer Procedure failure.
 * @param ctx - Pipeline context.
 * @returns Ctx with credentials.phoneNumber in wire format (or ctx
 *   verbatim when the bank doesn't declare a format / no phoneNumber).
 */
function withNormalisedCreds(ctx: IPipelineContext): IPipelineContext {
  const config = ctx.config;
  const format =
    'headless' in config && config.headless ? config.headless.phoneNumberFormat : undefined;
  if (format === undefined) return ctx;
  const creds = ctx.credentials as unknown as Record<string, unknown>;
  const raw = creds.phoneNumber;
  if (typeof raw !== 'string') return ctx;
  const rawShape = phoneShape(raw);
  const wire = formatPhoneNumber(raw, format);
  if (!wire.success) {
    ctx.logger.warn(
      { module: 'api-direct-call', reason: wire.errorMessage, format, rawShape },
      'phoneNumber normalisation failed — keeping raw input for downstream validation',
    );
    return ctx;
  }
  const wireShape = phoneShape(wire.value);
  ctx.logger.info(
    { module: 'api-direct-call', format, rawShape, wireShape },
    'phoneNumber normalised (PII-safe shape only)',
  );
  const normalisedCreds = { ...creds, phoneNumber: wire.value };
  return { ...ctx, credentials: normalisedCreds as unknown as IPipelineContext['credentials'] };
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
  const ctx = withNormalisedCreds(rawCtx);
  const busProc = resolveApiMediator(ctx, PHASE_LABEL);
  if (!isOk(busProc)) return busProc;
  const bus = busProc.value;
  const stratProc = createTokenStrategyFromConfig({ config });
  if (!isOk(stratProc)) return stratProc;
  const strategy = stratProc.value;
  const creds = mergeOptionsIntoCreds(ctx);
  bus.withTokenStrategy(strategy, ctx, creds);
  const primed = await safeInvoke('ACTION primeSession', () => bus.primeSession());
  if (!isOk(primed)) return primed;
  if (primed.value.length === 0) {
    return fail(ScraperErrorTypes.Generic, `${PHASE_LABEL} ACTION empty header`);
  }
  bus.setRawAuth(primed.value);
  // Propagate the flow's final-carry snapshot to the bus so the
  // scrape phase can read post-login slots (uId, deviceId16Hex, …)
  // when hydrating class-y body envelopes via `$ref: carry.<slot>`.
  const sessionContext = strategy.getLatestCarrySnapshot();
  bus.setSessionContext(sessionContext);
  await invokeAuthFlowComplete(ctx, strategy, primed.value);
  return succeed(ctx);
}

/**
 * Invoke ctx.options.onAuthFlowComplete when the strategy has a
 * captured long-term token to surface. Errors are caught + logged;
 * scrape success is not invalidated by callback failures.
 * @param ctx - Pipeline context.
 * @param strategy - Config-driven token strategy.
 * @param bearer - Authorization header value installed on the bus.
 * @returns Void promise.
 */
async function invokeAuthFlowComplete(
  ctx: IPipelineContext,
  strategy: IConfigTokenStrategy,
  bearer: string,
): Promise<boolean> {
  const opts = ctx.options as { onAuthFlowComplete?: IAuthFlowCallback };
  const callback = opts.onAuthFlowComplete;
  if (callback === undefined) return false;
  const longTermToken = strategy.getLatestLongTermToken();
  if (longTermToken.length === 0) return false;
  try {
    await callback({ longTermToken, bearer });
    return true;
  } catch (error) {
    const message = toErrorMessage(error as Error);
    ctx.logger.warn({
      message: `${PHASE_LABEL} onAuthFlowComplete callback threw: ${message}`,
    });
    return false;
  }
}

/**
 * POST stage — exercise a lightweight authenticated call from the probe
 * config. Exactly one of queryTag / urlTag must be set.
 * @param config - API-direct-call config.
 * @param ctx - Pipeline context.
 * @returns Propagated POST result.
 */
async function runApiDirectCallPost(
  config: IApiDirectCallConfig,
  ctx: IPipelineContext,
): Promise<Procedure<IPipelineContext>> {
  if (config.probe === undefined) return succeed(ctx);
  const busProc = resolveApiMediator(ctx, PHASE_LABEL);
  if (!isOk(busProc)) return busProc;
  const bus = busProc.value;
  const probeProc = await runProbe(config.probe, bus);
  if (!isOk(probeProc)) return probeProc;
  return succeed(ctx);
}

/** Probe response shape — opaque record so callers can introspect fields. */
type ProbeResponse = Record<string, unknown>;

/**
 * Fire the configured probe — queryTag preferred over urlTag.
 * @param probe - Probe block from the API-direct-call config.
 * @param bus - ApiMediator instance.
 * @returns Probe procedure.
 */
async function runProbe(probe: IProbeConfig, bus: IApiMediator): Promise<Procedure<ProbeResponse>> {
  const { queryTag, urlTag } = probe;
  if (queryTag !== undefined) {
    return safeInvoke('POST probe query', () => bus.apiQuery<ProbeResponse>(queryTag, {}));
  }
  if (urlTag !== undefined) {
    return safeInvoke('POST probe url', () => bus.apiGet<ProbeResponse>(urlTag));
  }
  return fail(ScraperErrorTypes.Generic, `${PHASE_LABEL} POST probe config missing`);
}

export { runApiDirectCallAction, runApiDirectCallPost, runApiDirectCallPre };
