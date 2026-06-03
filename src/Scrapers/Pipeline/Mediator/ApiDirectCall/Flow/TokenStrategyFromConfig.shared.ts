/**
 * Shared helpers for the TokenStrategyFromConfig cluster:
 * creds reading, auth-header formatting, warm-seed picking,
 * warm-arg assembly, and flow-kind gating.
 */

import { ScraperErrorTypes } from '../../../../Base/ErrorTypes.js';
import ScraperError from '../../../../Base/ScraperError.js';
import type { Procedure } from '../../../Types/Procedure.js';
import { fail, succeed } from '../../../Types/Procedure.js';
import type { JsonValue } from '../Envelope/JsonPointer.js';
import type { IApiDirectCallConfig } from '../IApiDirectCallConfig.js';
import { isJwtFresh } from '../Jwt/GenericJwtClaims.js';
import type { GenericCreds, IMakeWarmArgs, IRunFlowArgs } from './TokenStrategyFromConfig.types.js';

/** Default strategy display name. */
const STRATEGY_NAME_DEFAULT = 'ApiDirectCall';

/** Diagnostic message — warmStart required for makeWarmArgs. */
const WARM_REQUIRED_MSG = 'makeWarmArgs requires config.warmStart to be set';

/**
 * Read a string-valued creds field, returning '' when absent or wrong type.
 * @param creds - Caller credentials.
 * @param field - Field name.
 * @returns String value or ''.
 */
function readCredsString(creds: GenericCreds, field: string): string {
  const value = creds[field];
  if (typeof value !== 'string') return '';
  return value;
}

/**
 * Format the Authorization header value per config.authScheme.
 * @param config - API-direct-call config.
 * @param token - Raw token string (no prefix).
 * @returns Authorization header value.
 */
function formatAuthValue(config: IApiDirectCallConfig, token: string): string {
  if (config.authScheme === 'bearer') return `Bearer ${token}`;
  return token;
}

/**
 * Decide whether to take the warm-start path.
 * @param config - API-direct-call config.
 * @param creds - Caller credentials.
 * @returns Stored seed string, or `false` when cold path should run.
 */
function pickWarmSeed(config: IApiDirectCallConfig, creds: GenericCreds): string | false {
  const warm = config.warmStart;
  if (warm === undefined) return false;
  const stored = readCredsString(creds, warm.credsField);
  if (stored.length === 0) return false;
  if (config.jwtClaims !== undefined && !isJwtFresh(stored, config.jwtClaims)) {
    return false;
  }
  return stored;
}

/**
 * Build the warm-path IRunFlowArgs given a stored seed value.
 * @param args - Config + bus + creds + stored seed + companyId.
 * @returns Warm-path run args.
 */
function makeWarmArgs(args: IMakeWarmArgs): IRunFlowArgs {
  const warm = args.config.warmStart;
  if (warm === undefined) throw new ScraperError(WARM_REQUIRED_MSG);
  const initialCarry: Record<string, JsonValue> = { [warm.carryField]: args.stored };
  const { config, bus, creds, companyId } = args;
  return { config, bus, creds, companyId, initialCarry, startStepIndex: warm.fromStepIndex };
}

/**
 * Validate the config's flow-kind — only 'sms-otp' is implemented.
 * @param config - Config literal.
 * @returns Procedure gate.
 */
function gateFlowKind(config: IApiDirectCallConfig): Procedure<true> {
  if (config.flow === 'sms-otp') return succeed(true);
  return fail(ScraperErrorTypes.Generic, `unsupported flow-kind: ${config.flow}`);
}

export {
  formatAuthValue,
  gateFlowKind,
  makeWarmArgs,
  pickWarmSeed,
  readCredsString,
  STRATEGY_NAME_DEFAULT,
};
