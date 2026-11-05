/**
 * RefPresence — whether an optional ref (N49) has a value to send. Only a
 * source that varies per run can lack one: a carry slot, a credential field
 * or the step's cookie. Every other ref counts as present, so its resolve
 * failure (an unknown token, a `config.` miss, a bad cookie) still fails.
 *
 * Zero bank knowledge. Rule #11 compliant.
 */

import type { RefToken } from '../ConfigContracts/index.js';
import type { ITemplateScope } from './RefResolver.js';

/** Whether a source lacks the named value. */
type AbsenceCheck = (name: string, scope: ITemplateScope) => boolean;

/**
 * Whether the carry lacks a slot.
 * @param name - Carry slot.
 * @param scope - Template scope.
 * @returns True when the slot is not carried.
 */
function isCarryAbsent(name: string, scope: ITemplateScope): boolean {
  return !Object.hasOwn(scope.carry, name);
}

/**
 * Whether the credentials lack a field.
 * @param name - Credential field.
 * @param scope - Template scope.
 * @returns True when the field is not set.
 */
function isCredAbsent(name: string, scope: ITemplateScope): boolean {
  return scope.creds[name] === undefined;
}

/**
 * Whether the step's jar view lacks a cookie.
 * @param name - Cookie name.
 * @param scope - Template scope.
 * @returns True without a jar view or without the cookie in it.
 */
function isCookieAbsent(name: string, scope: ITemplateScope): boolean {
  if (scope.cookie === undefined) return true;
  const found = scope.cookie(name);
  return 'has' in found && !found.has;
}

/** Ref families whose source can lack a value. */
const ABSENCE_CHECKS: readonly { readonly prefix: string; readonly isAbsent: AbsenceCheck }[] = [
  { prefix: 'carry.', isAbsent: isCarryAbsent },
  { prefix: 'creds.', isAbsent: isCredAbsent },
  { prefix: 'cookie.', isAbsent: isCookieAbsent },
];

/**
 * Whether a ref's source has no value for it.
 * @param token - Ref token.
 * @param scope - Template scope.
 * @returns True for a carry, creds or cookie ref whose value is absent.
 */
function isRefAbsent(token: RefToken, scope: ITemplateScope): boolean {
  const family = ABSENCE_CHECKS.find(entry => token.startsWith(entry.prefix));
  if (family === undefined) return false;
  const name = token.slice(family.prefix.length);
  return family.isAbsent(name, scope);
}

export default isRefAbsent;
export { isRefAbsent };
