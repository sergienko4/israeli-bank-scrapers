/**
 * Required credentials — checked before the first step, so a missing or
 * malformed field fails the flow by name without sending a request. Only
 * field names reach the message; values never do.
 */

import { ScraperErrorTypes } from '../../../../Base/ErrorTypes.js';
import type { Procedure } from '../../../Types/Procedure.js';
import { fail, succeed } from '../../../Types/Procedure.js';
import type { CredRule, IApiDirectCallConfig } from '../ConfigContracts/index.js';
import { readCredsString } from './TokenStrategyFromConfig.shared.js';
import type { GenericCreds } from './TokenStrategyFromConfig.types.js';

/** One required field and the rule its value must meet. */
type CredEntry = readonly [string, CredRule];

const DIGITS = /^\d+$/;
const SIX_DIGITS = /^\d{6}$/;

/** Rule → predicate; a non-string value reads as '' and fails every rule. */
const CRED_RULES: Readonly<Record<CredRule, (value: string) => boolean>> = {
  /**
   * Holds something other than whitespace.
   * @param value - Credential value.
   * @returns True when non-blank.
   */
  nonEmpty: (value): boolean => value.trim().length > 0,
  /**
   * Digits only, at least one.
   * @param value - Credential value.
   * @returns True when all digits.
   */
  digits: (value): boolean => DIGITS.test(value),
  /**
   * Exactly six digits.
   * @param value - Credential value.
   * @returns True when six digits.
   */
  sixDigits: (value): boolean => SIX_DIGITS.test(value),
};

/** Message prefix; the names of the failing fields follow it. */
const MISSING_CREDS_PREFIX = 'Missing or malformed credentials: ';

/**
 * Whether one required field meets its rule.
 * @param creds - Caller credentials.
 * @param entry - Field name and rule.
 * @returns True when the value passes.
 */
function isCredSound(creds: GenericCreds, entry: CredEntry): boolean {
  const [field, rule] = entry;
  const value = readCredsString(creds, field);
  return CRED_RULES[rule](value);
}

/**
 * Check every required credential before any request is sent.
 * @param config - API-direct-call config.
 * @param creds - Caller credentials.
 * @returns Success, or a Generic failure naming the bad fields.
 */
function checkRequiredCreds(config: IApiDirectCallConfig, creds: GenericCreds): Procedure<true> {
  const entries = Object.entries(config.requiredCreds ?? {});
  const bad = entries.filter((entry): boolean => !isCredSound(creds, entry));
  if (bad.length === 0) return succeed(true);
  const names = bad.map(([field]): string => field).join(', ');
  return fail(ScraperErrorTypes.Generic, `${MISSING_CREDS_PREFIX}${names}`);
}

export default checkRequiredCreds;
export { checkRequiredCreds };
