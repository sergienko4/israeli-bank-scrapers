/**
 * PRE-stage classification + creds merging for the ApiDirectCall phase.
 */

import type {
  IPersistentAuthInput,
  PersistentAuthStateCallback,
} from '../../Types/Domain/PersistentAuthInput.js';
import type { LoginKind } from '../../Types/LoginKind.js';
import { none, type Option, some } from '../../Types/Option.js';
import type { IPipelineContext } from '../../Types/PipelineContext.js';
import type { Procedure } from '../../Types/Procedure.js';
import { isOk, succeed } from '../../Types/Procedure.js';
import { resolvePersistentAuthMode } from './ApiDirectCallActions.persistent.js';
import type { IApiDirectCallConfig } from './ConfigContracts/index.js';
import type { GenericCreds, PersistentAuthMode } from './Flow/TokenStrategyFromConfig.js';
import { isJwtFresh } from './Jwt/GenericJwtClaims.js';

/** Option keys that carry durable device-auth secrets. */
const PERSISTENT_AUTH_OPTION_KEYS: ReadonlySet<string> = new Set([
  'persistentAuthState',
  'onPersistentAuthStateUpdate',
]);

/**
 * Drop the durable device-auth secrets from a merged credential record.
 * @param merged - Credentials merged with options.
 * @returns Record without the persistent-auth option keys.
 */
function withoutPersistentAuthOptions(merged: Record<string, unknown>): GenericCreds {
  const entries = Object.entries(merged);
  const kept = entries.filter(([key]): boolean => !PERSISTENT_AUTH_OPTION_KEYS.has(key));
  return Object.fromEntries(kept);
}

/**
 * Merge ScraperOptions into credentials so generic config refs can
 * read options-scope fields without knowing the distinction. The durable
 * device-auth options are withheld: they reach the token strategy only
 * through {@link readPersistentAuthInput}.
 * @param ctx - Pipeline context.
 * @returns Combined record for ApiDirectCall token flows.
 */
function mergeOptionsIntoCreds(ctx: IPipelineContext): GenericCreds {
  const opts = ctx.options as unknown as Record<string, unknown>;
  const creds = ctx.credentials as unknown as Record<string, unknown>;
  return withoutPersistentAuthOptions({ ...creds, ...opts });
}

/**
 * Read the opaque durable state when it was supplied as a string.
 * @param ctx - Pipeline context.
 * @returns Some(state) for a string value, none() otherwise.
 */
function readStateOption(ctx: IPipelineContext): Option<string> {
  const state = ctx.options.persistentAuthState;
  if (typeof state !== 'string') return none();
  return some(state);
}

/**
 * Read the state-update callback when it was supplied as a function.
 * @param ctx - Pipeline context.
 * @returns Some(callback) for a function value, none() otherwise.
 */
function readUpdateOption(ctx: IPipelineContext): Option<PersistentAuthStateCallback> {
  const onUpdate = ctx.options.onPersistentAuthStateUpdate;
  if (typeof onUpdate !== 'function') return none();
  return some(onUpdate);
}

/**
 * Whether a supplied option value has the wrong runtime type. JavaScript
 * callers bypass the declared types, so an unusable value is flagged rather
 * than silently treated as absent.
 * @param value - Raw option value.
 * @param expected - The `typeof` result the option requires.
 * @returns True when a value is present but has another type.
 */
function isWrongType(value: unknown, expected: 'string' | 'function'): boolean {
  if (value === undefined) return false;
  return typeof value !== expected;
}

/**
 * Lift the durable device-auth options into their own record. No bank mode is
 * chosen here; banks without a persistent-auth config ignore the result.
 * @param ctx - Pipeline context.
 * @returns Persistent-auth input with presence and runtime-type verdicts.
 */
function readPersistentAuthInput(ctx: IPipelineContext): IPersistentAuthInput {
  const rawState: unknown = ctx.options.persistentAuthState;
  const rawUpdate: unknown = ctx.options.onPersistentAuthStateUpdate;
  const isMalformed = isWrongType(rawState, 'string') || isWrongType(rawUpdate, 'function');
  return { state: readStateOption(ctx), onUpdate: readUpdateOption(ctx), isMalformed };
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
 * Resolve the durable device-auth mode from the context's options and creds.
 * @param config - API-direct-call config.
 * @param ctx - Pipeline context.
 * @returns Resolved mode, or a category-only failure.
 */
function resolveContextAuthMode(
  config: IApiDirectCallConfig,
  ctx: IPipelineContext,
): Procedure<PersistentAuthMode> {
  const input = readPersistentAuthInput(ctx);
  const creds = mergeOptionsIntoCreds(ctx);
  return resolvePersistentAuthMode(config, input, creds);
}

/**
 * Classify the run for the PRE diagnostic. A durable resume reuses the
 * existing password-only kind; every other mode keeps the legacy verdict.
 * @param config - API-direct-call config.
 * @param ctx - Pipeline context.
 * @returns LoginKind hint.
 */
function classifyRunKind(config: IApiDirectCallConfig, ctx: IPipelineContext): LoginKind {
  const mode = resolveContextAuthMode(config, ctx);
  if (isOk(mode) && mode.value.kind === 'resume') return 'password-only';
  const creds = mergeOptionsIntoCreds(ctx);
  return classifyLoginKind(config, creds);
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
  const kind = classifyRunKind(config, ctx);
  ctx.logger.debug({ message: `[api-direct-call] PRE kind='${kind}' config-driven` });
  return succeed(ctx);
}

export {
  mergeOptionsIntoCreds,
  readPersistentAuthInput,
  resolveContextAuthMode,
  runApiDirectCallPre,
};
