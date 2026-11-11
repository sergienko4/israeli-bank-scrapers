/**
 * Shared helpers for the TokenStrategyFromConfig cluster:
 * creds reading, warm-seed picking, warm-arg assembly, and flow-kind gating.
 */

import { ScraperErrorTypes } from '../../../../../Base/ErrorTypes.js';
import ScraperError from '../../../../../Base/ScraperError.js';
import { getDebug } from '../../../../Logging/Debug.js';
import type { Procedure } from '../../../../Types/Procedure.js';
import { fail, isOk, succeed } from '../../../../Types/Procedure.js';
import type { IApiDirectCallConfig } from '../../ConfigContracts/index.js';
import { isJwtFresh } from '../../Jwt/GenericJwtClaims.js';
import { MAX_ACCESS_TOKEN_CHARS } from '../../PersistentAuthStateRules.js';
import type { GenericCreds, IMakeWarmArgs, IRunFlowArgs } from './TokenStrategyFromConfig.types.js';

const LOG = getDebug(import.meta.url);

/** A replayable token: printable ASCII only, so no CR/LF or control bytes. */
const PRINTABLE_ASCII = /^[\x20-\x7E]+$/;

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
 * Whether a stored seed looks like a token: printable ASCII within the
 * access-token length cap.
 * @param stored - Non-empty stored seed.
 * @returns True when the seed may be replayed.
 */
function isSeedShaped(stored: string): boolean {
  return stored.length <= MAX_ACCESS_TOKEN_CHARS && PRINTABLE_ASCII.test(stored);
}

/**
 * Drop a malformed seed, warning with the field name only — never the value.
 * @param credsField - Creds field the seed came from.
 * @returns False, so the cold path runs.
 */
function dropMalformedSeed(credsField: string): false {
  LOG.warn({ credsField }, 'Stored warm token is malformed — running the cold login');
  return false;
}

/**
 * Whether the seed passes the config's local JWT freshness check, if any.
 * A 'bank-call' warm start leaves the judgement to the bank, so it skips the
 * local check even when `jwtClaims` is set.
 * @param config - API-direct-call config.
 * @param stored - Stored seed.
 * @returns True when there is no JWT check or the token is fresh.
 */
function isJwtGateOpen(config: IApiDirectCallConfig, stored: string): boolean {
  if (config.warmStart?.validation === 'bank-call') return true;
  if (config.jwtClaims === undefined) return true;
  return isJwtFresh(stored, config.jwtClaims);
}

/**
 * Whether the caller supplied a stored seed at all, before any local check.
 * A wrong-type value counts as supplied, so its refusal still earns the
 * cold-fallback warning.
 * @param config - API-direct-call config.
 * @param creds - Caller credentials.
 * @returns True when warm start is configured and the seed field holds a value.
 */
function isWarmSeedSupplied(config: IApiDirectCallConfig, creds: GenericCreds): boolean {
  if (config.warmStart === undefined) return false;
  const value = creds[config.warmStart.credsField];
  return value !== undefined && value !== null && value !== '';
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
  if (!isSeedShaped(stored)) return dropMalformedSeed(warm.credsField);
  if (!isJwtGateOpen(config, stored)) return false;
  return stored;
}

/**
 * Build the warm-path IRunFlowArgs given the restored carry.
 * @param args - Config + bus + creds + restored carry + companyId.
 * @returns Warm-path run args.
 */
function makeWarmArgs(args: IMakeWarmArgs): IRunFlowArgs {
  const warm = args.config.warmStart;
  if (warm === undefined) throw new ScraperError(WARM_REQUIRED_MSG);
  const { config, bus, creds, companyId, initialCarry } = args;
  return { config, bus, creds, companyId, initialCarry, startStepIndex: warm.fromStepIndex };
}

/** Why a finished token that does not fit the limit is not published. */
const OVER_LIMIT = 'over maxTokenChars';

/** A bound warm start's creds field and token ceiling. */
interface IWarmExportLimit {
  readonly credsField: string;
  readonly maxTokenChars: number;
}

/**
 * Skip a stored token, naming the reason and the creds field — never the token.
 * @param credsField - Creds field the token came from.
 * @param reason - Rejection text.
 * @returns False, so the cold login runs.
 */
function skipWarmRestore(credsField: string, reason: string): false {
  LOG.warn({ credsField }, `warm start skipped: ${reason}`);
  return false;
}

/**
 * Publish no token, naming the reason and the creds field — never a value.
 * @param credsField - Creds field the token is published for.
 * @param reason - Why the export is skipped.
 * @returns '' — no token.
 */
function skipWarmExport(credsField: string, reason: string): '' {
  LOG.warn({ credsField }, `warm start export skipped: ${reason}`);
  return '';
}

/**
 * Publish an encoded token when it fits the warm start's ceiling.
 * @param limit - Creds field and ceiling.
 * @param token - Encoded token, or why it could not be encoded.
 * @returns The token, or '' when it failed or does not fit.
 */
function publishWithin(limit: IWarmExportLimit, token: Procedure<string>): string {
  if (!isOk(token)) return skipWarmExport(limit.credsField, token.errorMessage);
  if (token.value.length <= limit.maxTokenChars) return token.value;
  const chars = String(token.value.length);
  return skipWarmExport(limit.credsField, `${OVER_LIMIT} (${chars} chars)`);
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
  gateFlowKind,
  isWarmSeedSupplied,
  makeWarmArgs,
  pickWarmSeed,
  publishWithin,
  readCredsString,
  skipWarmRestore,
  STRATEGY_NAME_DEFAULT,
};
