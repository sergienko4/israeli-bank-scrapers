/**
 * Raw carry warm start for TokenStrategyFromConfig: the stored token is one
 * carry slot (`WarmRawCarry.ts`), seeded before the resumed flow and replaced
 * by the token a finished flow publishes. A token minted now is bound to the
 * provider and account values; a pre-envelope raw token is still accepted.
 */

import type { Procedure } from '../../../../Types/Procedure.js';
import { isOk, succeed } from '../../../../Types/Procedure.js';
import type { ICarryWarmStart } from '../../ConfigContracts/index.js';
import { isJwtFresh } from '../../Jwt/GenericJwtClaims.js';
import { MAX_ACCESS_TOKEN_CHARS } from '../../PersistentAuthStateRules.js';
import type { IRawCarryExpectation } from '../WarmRawCarry.js';
import { decodeRawCarry, encodeRawCarry, isRawCarryToken } from '../WarmRawCarry.js';
import {
  accountTagKeyOf,
  publishWithin,
  readCredsString,
  skipWarmRestore,
} from './TokenStrategyFromConfig.shared.js';
import type { IWarmRunArgs, WarmCarry } from './TokenStrategyFromConfig.types.js';

/** A replayable raw value: printable ASCII, within the token cap. */
const PRINTABLE_ASCII = /^[\x20-\x7E]+$/;

/** A carry warm start that binds new tokens to a provider and accounts. */
interface IBoundCarryWarm extends ICarryWarmStart {
  readonly provider: string;
  readonly accountFields: readonly string[];
}

/**
 * Whether a carry warm start binds new tokens.
 * @param warm - Carry warm start.
 * @returns True when provider and account fields are configured.
 */
function isBoundRawWarm(warm: ICarryWarmStart): warm is IBoundCarryWarm {
  return warm.provider !== undefined && warm.accountFields !== undefined;
}

/**
 * What a stored raw token is checked against.
 * @param args - Run and credentials.
 * @param warm - Bound carry warm start.
 * @returns Provider, account values, tag key and limit.
 */
function rawExpected(args: IWarmRunArgs, warm: IBoundCarryWarm): IRawCarryExpectation {
  const accounts = warm.accountFields.map((field): string => readCredsString(args.creds, field));
  const tagKey = accountTagKeyOf(args.creds, warm.accountTagKey ?? '');
  return { provider: warm.provider, accounts, tagKey, maxChars: MAX_ACCESS_TOKEN_CHARS };
}

/**
 * Whether a raw stored token passes the config's local JWT gate. A
 * 'bank-call' warm start leaves the judgement to the bank; a 'jwt' warm start
 * checks the unwrapped value, never the envelope.
 * @param args - Run and config.
 * @param raw - Raw value inside the envelope, or a legacy raw token.
 * @returns True when there is no JWT check or the token is fresh.
 */
function isRawFresh(args: IWarmRunArgs, raw: string): boolean {
  const warm = args.config.warmStart;
  if (warm?.validation === 'bank-call') return true;
  if (args.config.jwtClaims === undefined) return true;
  return isJwtFresh(raw, args.config.jwtClaims);
}

/**
 * Decode a bound raw token.
 * @param args - Run and credentials.
 * @param warm - Bound carry warm start.
 * @param stored - Stored token.
 * @returns The raw value, or the rejection.
 */
function decodeBoundRaw(
  args: IWarmRunArgs,
  warm: IBoundCarryWarm,
  stored: string,
): Procedure<string> {
  const expected = rawExpected(args, warm);
  return decodeRawCarry(stored, expected);
}

/**
 * Restore one raw carry token. A token without the `v1.` prefix is the
 * pre-envelope form and is accepted unchanged.
 * @param args - Run and credentials.
 * @param warm - Carry warm start.
 * @param stored - Stored token.
 * @returns The seeded carry, or false when the envelope is refused.
 */
function restoreRawCarry(
  args: IWarmRunArgs,
  warm: ICarryWarmStart,
  stored: string,
): WarmCarry | false {
  if (!isBoundRawWarm(warm) || !isRawCarryToken(stored)) return seededRaw(args, warm, stored);
  return restoreBoundRaw(args, warm, stored);
}

/**
 * Unwrap a bound envelope, then apply the JWT gate to its value.
 * @param args - Run and credentials.
 * @param warm - Bound carry warm start.
 * @param stored - Stored envelope.
 * @returns The seeded carry, or false when the envelope is refused.
 */
function restoreBoundRaw(
  args: IWarmRunArgs,
  warm: IBoundCarryWarm,
  stored: string,
): WarmCarry | false {
  const decoded = decodeBoundRaw(args, warm, stored);
  if (!isOk(decoded)) return skipWarmRestore(warm.credsField, decoded.errorMessage);
  return seededRaw(args, warm, decoded.value);
}

/**
 * Seed a raw value, running the JWT gate on the value itself.
 * @param args - Run and config.
 * @param warm - Carry warm start.
 * @param raw - Unwrapped raw value or legacy raw token.
 * @returns The carry, or false when the value is stale.
 */
function seededRaw(args: IWarmRunArgs, warm: ICarryWarmStart, raw: string): WarmCarry | false {
  const isShaped =
    raw.length > 0 && raw.length <= MAX_ACCESS_TOKEN_CHARS && PRINTABLE_ASCII.test(raw);
  if (!isShaped || !isRawFresh(args, raw)) return false;
  return { [warm.carryField]: raw };
}

/**
 * Encode a finished flow's raw token when the config binds one.
 * @param args - Run and credentials.
 * @param warm - Carry warm start.
 * @param raw - The flow's long-term token.
 * @returns The published token, or '' when it does not fit.
 */
function exportRawCarry(args: IWarmRunArgs, warm: ICarryWarmStart, raw: string): string {
  if (!isBoundRawWarm(warm) || raw.length === 0) return raw;
  const identity = rawExpected(args, warm);
  const encoded = encodeRawCarry(identity, raw);
  const limit = { credsField: warm.credsField, maxTokenChars: MAX_ACCESS_TOKEN_CHARS };
  if (!isOk(encoded)) return publishWithin(limit, encoded);
  if (encoded.value.length <= MAX_ACCESS_TOKEN_CHARS) return encoded.value;
  // The envelope grew past the ceiling; the raw value itself still fits.
  const fallback = succeed(raw);
  return publishWithin(limit, fallback);
}

export { exportRawCarry, restoreRawCarry };
