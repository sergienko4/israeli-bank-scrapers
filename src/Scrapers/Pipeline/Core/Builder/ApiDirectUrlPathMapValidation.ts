/**
 * Validates path-map policies before a flow starts.
 */

import { isQueryKey } from '../../Mediator/ApiDirectCall/Flow/Lifecycle/FlowInitCarry.ops.js';
import { areSdkUrlRulesValid } from './ApiDirectStructuredUrlValidation.js';

const SAFE_PATH = /^\/[\w.~/-]*$/u;

/**
 * Whether a path map contains nonempty safe keys and absolute paths.
 * @param value - Untrusted path map.
 * @returns True for a valid map.
 */
function isPathMap(value: unknown): boolean {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const entries = Object.entries(value);
  return (
    entries.length > 0 &&
    entries.every(([key, path]) => {
      return isQueryKey(key) && typeof path === 'string' && SAFE_PATH.test(path);
    })
  );
}

/**
 * Whether an untrusted mapping names safe source and destination policies.
 * @param value - Candidate path-map operation.
 * @returns True for a valid path-map operation.
 */
function isUrlPathMapValid(value: object): boolean {
  const key: unknown = Reflect.get(value, 'key');
  const paths: unknown = Reflect.get(value, 'paths');
  const source: unknown = Reflect.get(value, 'source');
  const url: unknown = Reflect.get(value, 'url');
  if (typeof key !== 'string' || !isQueryKey(key)) return false;
  if (!isPathMap(paths)) return false;
  return areSdkUrlRulesValid(source) && areSdkUrlRulesValid(url);
}

export default isUrlPathMapValid;
