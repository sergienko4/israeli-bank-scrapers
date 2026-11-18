/**
 * Raw carry warm start for TokenStrategyFromConfig: the stored token is one
 * carry slot (`WarmRawCarry.ts`), seeded before the resumed flow and replaced
 * by the token a finished flow publishes. A token minted now is bound to the
 * provider and account values; a pre-envelope raw token is still accepted.
 */

import type { Procedure } from '../../../../Types/Procedure.js';
import { isOk } from '../../../../Types/Procedure.js';
import type { ICarryWarmStart } from '../../ConfigContracts/index.js';
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
 * The carry a legacy token seeds unchanged.
 * @param warm - Carry warm start.
 * @param stored - Stored token.
 * @returns The seeded carry.
 */
function legacyCarry(warm: ICarryWarmStart, stored: string): WarmCarry {
  return { [warm.carryField]: stored };
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
  if (!isBoundRawWarm(warm) || !isRawCarryToken(stored)) return legacyCarry(warm, stored);
  const decoded = decodeBoundRaw(args, warm, stored);
  if (!isOk(decoded)) return skipWarmRestore(warm.credsField, decoded.errorMessage);
  return { [warm.carryField]: decoded.value };
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
  return publishWithin(limit, encoded);
}

export { exportRawCarry, restoreRawCarry };
