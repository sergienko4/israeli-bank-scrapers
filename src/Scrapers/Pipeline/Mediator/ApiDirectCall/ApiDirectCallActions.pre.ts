/**
 * PRE-stage classification + creds merging for the ApiDirectCall phase.
 */

import type { LoginKind } from '../../Types/LoginKind.js';
import type { IPipelineContext } from '../../Types/PipelineContext.js';
import type { Procedure } from '../../Types/Procedure.js';
import { succeed } from '../../Types/Procedure.js';
import type { GenericCreds } from './Flow/TokenStrategyFromConfig.js';
import type { IApiDirectCallConfig } from './IApiDirectCallConfig.js';
import { isJwtFresh } from './Jwt/GenericJwtClaims.js';

/**
 * Merge ScraperOptions into credentials so generic config refs can
 * read options-scope fields without knowing the distinction.
 * @param ctx - Pipeline context.
 * @returns Combined record for ApiDirectCall token flows.
 */
function mergeOptionsIntoCreds(ctx: IPipelineContext): GenericCreds {
  const opts = ctx.options as unknown as Record<string, unknown>;
  const creds = ctx.credentials as unknown as Record<string, unknown>;
  return { ...creds, ...opts };
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

export { mergeOptionsIntoCreds, runApiDirectCallPre };
