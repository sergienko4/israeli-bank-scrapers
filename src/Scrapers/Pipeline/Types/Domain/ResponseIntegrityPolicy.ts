/**
 * Validates untrusted response-integrity settings at configuration and transport boundaries.
 */

import type { IResponseIntegrity } from './FetchPolicy.js';

const MAX_RESPONSE_BYTES = 8_388_608;
const SHA256_PATTERN = /^[0-9a-f]{64}$/;

/**
 * Checks the bounds and optional digest of an integrity policy.
 * @param value - Untrusted policy.
 * @returns Whether the policy is safe to enforce.
 */
function isResponseIntegrity(value: unknown): value is IResponseIntegrity {
  if (typeof value !== 'object' || value === null) return false;
  const maxBytes: unknown = Reflect.get(value, 'maxBytes');
  const sha256: unknown = Reflect.get(value, 'sha256');
  if (typeof maxBytes !== 'number' || !Number.isSafeInteger(maxBytes)) return false;
  if (maxBytes < 1 || maxBytes > MAX_RESPONSE_BYTES) return false;
  return sha256 === undefined || (typeof sha256 === 'string' && SHA256_PATTERN.test(sha256));
}

export default isResponseIntegrity;
export { isResponseIntegrity };
