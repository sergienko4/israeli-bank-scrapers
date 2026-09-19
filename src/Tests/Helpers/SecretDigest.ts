/**
 * SecretDigest — reduce a secret-bearing string to a value that is safe to
 * compare, print and diff.
 *
 * <p>Jest publishes both operands of a failed `toBe` into the console and the
 * CI log. That is harmless for fixtures, but the E2E token-cache suite probes
 * the developer's *real* shared cache, which holds a live bank token with a
 * ten-year lifetime: one failing assertion would publish it (CWE-532).
 *
 * <p>Hashing first removes the secret from the test altogether rather than
 * merely hiding it from the reporter. A SHA-256 over a high-entropy JWT is
 * not reversible, so the digest can be asserted on directly — the comparison
 * stays exact and the failure diff stays readable.
 */

import { createHash } from 'node:crypto';

/** Marker for "nothing was there", distinct from any real digest. */
const ABSENT = '';

/**
 * Digest a secret-bearing string.
 * @param content - Value that must not reach a reporter; never logged.
 * @returns Hex SHA-256 of the content, or '' when the content is empty.
 */
function digestOf(content: string): string {
  if (content.length === 0) return ABSENT;
  const hash = createHash('sha256');
  hash.update(content, 'utf8');
  return hash.digest('hex');
}

export { ABSENT, digestOf };
