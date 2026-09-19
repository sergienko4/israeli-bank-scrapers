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
import { readFile } from 'node:fs/promises';

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

/**
 * Decide what a failed read means.
 * @param thrown - Whatever the read raised.
 * @returns The absent marker, when and only when the file was missing.
 */
function absentOrRethrow(thrown: unknown): string {
  const failure = thrown as NodeJS.ErrnoException;
  if (failure.code === 'ENOENT') return ABSENT;
  throw thrown;
}

/**
 * Digest a file's contents, treating only a missing file as absent.
 *
 * <p>A blanket `catch` would report an unreadable file — `EACCES` when the
 * path belongs to another user, `EIO` on a failing disk — as "nothing was
 * there". A caller comparing a before-and-after digest would then see two
 * empty strings and pass without having observed anything at all, which is
 * the one outcome such a check exists to rule out. Absence is `ENOENT` and
 * nothing else.
 * @param target - Absolute path whose contents must not reach a reporter.
 * @returns Hex SHA-256 of the contents, or '' when the path does not exist.
 */
async function digestFileOrAbsent(target: string): Promise<string> {
  try {
    const raw = await readFile(target, 'utf8');
    return digestOf(raw);
  } catch (thrown: unknown) {
    return absentOrRethrow(thrown);
  }
}

export { ABSENT, digestFileOrAbsent, digestOf };
