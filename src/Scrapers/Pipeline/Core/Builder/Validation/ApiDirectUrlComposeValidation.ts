/**
 * Validates URL composition policies before a flow starts.
 */

import { isQueryKey } from '../../../Mediator/ApiDirectCall/Flow/FlowUrlQuery.js';
import { areSdkUrlRulesValid } from '../Captures/ApiDirectStructuredUrlValidation.js';

const SAFE_PATH = /^\/[\w.~/-]*$/u;

/**
 * Whether an unknown value is a non-array record.
 * @param value - Untrusted value.
 * @returns True for a record.
 */
function isRecord(value: unknown): value is object {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Whether a value is a canonical HTTPS origin.
 * @param value - Candidate base.
 * @returns True for a canonical origin.
 */
function isOrigin(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  const parsed = URL.parse(value);
  return parsed?.protocol === 'https:' && parsed.origin === value;
}

/**
 * Whether a configured path is absolute and stable under URL normalization.
 * @param path - Candidate path.
 * @param base - HTTPS base.
 * @returns True for a stable safe path.
 */
function isSafePath(path: unknown, base: string): boolean {
  if (typeof path !== 'string' || !SAFE_PATH.test(path)) return false;
  return URL.parse(path, base)?.pathname === path;
}

/**
 * Whether required keys are nonempty, safe and distinct.
 * @param value - Candidate key list.
 * @returns True for a usable key list.
 */
function isRequiredKeys(value: unknown): boolean {
  if (!Array.isArray(value) || value.length === 0) return false;
  if (!value.every((key: unknown) => typeof key === 'string' && isQueryKey(key))) return false;
  return new Set(value).size === value.length;
}

/**
 * Whether an optional merge policy has safe keys and an HTTPS source.
 * @param value - Candidate merge policy.
 * @returns True for an absent or valid policy.
 */
function isMergeValid(value: unknown): boolean {
  if (value === undefined) return true;
  if (!isRecord(value)) return false;
  const key: unknown = Reflect.get(value, 'setKey');
  if (typeof key !== 'string' || !isQueryKey(key)) return false;
  const keys: unknown = Reflect.get(value, 'requiredKeys');
  const source: unknown = Reflect.get(value, 'source');
  return isRequiredKeys(keys) && areSdkUrlRulesValid(source);
}

/**
 * Whether an untrusted URL composition declares valid routing policies.
 * @param value - Candidate composition operation.
 * @returns True for a valid operation.
 */
function isUrlComposeValid(value: object): boolean {
  const base: unknown = Reflect.get(value, 'base');
  const path: unknown = Reflect.get(value, 'path');
  const source: unknown = Reflect.get(value, 'source');
  const url: unknown = Reflect.get(value, 'url');
  const merge: unknown = Reflect.get(value, 'merge');
  if (!isOrigin(base) || (path !== undefined && !isSafePath(path, base))) return false;
  if (!areSdkUrlRulesValid(source) || !areSdkUrlRulesValid(url)) return false;
  return isMergeValid(merge);
}

export default isUrlComposeValid;
