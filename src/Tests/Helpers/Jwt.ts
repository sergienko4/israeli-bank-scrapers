/**
 * Shared JWT fixtures for tests that exercise `jwtClaims` freshness gates.
 *
 * `isJwtFresh` only decodes the payload segment, so these fixtures are
 * unsigned: the signature segment is a placeholder. Nothing here verifies a
 * signature, and no fixture carries a real credential.
 */

/**
 * Build an unsigned compact JWT carrying the supplied payload claims.
 * @param claims - Payload claims to encode.
 * @returns Compact JWT string with a placeholder signature.
 */
function makeJwtWithClaims(claims: Readonly<Record<string, unknown>>): string {
  const headerJson = JSON.stringify({ alg: 'none' });
  const headerBuffer = Buffer.from(headerJson);
  const header = headerBuffer.toString('base64url');
  const claimsJson = JSON.stringify(claims);
  const claimsBuffer = Buffer.from(claimsJson);
  const payload = claimsBuffer.toString('base64url');
  return `${header}.${payload}.sig`;
}

/**
 * Build an unsigned JWT whose `exp` sits a given offset from now.
 * @param deltaSeconds - Seconds from now; negative values yield a stale token.
 * @returns Compact JWT string.
 */
function makeJwtExpiringIn(deltaSeconds: number): string {
  const exp = Math.floor(Date.now() / 1000) + deltaSeconds;
  return makeJwtWithClaims({ exp });
}

/**
 * Build an unsigned JWT with an `exp` offset plus extra distinguishing claims.
 *
 * Two fixtures minted in the same second with only an `exp` are byte-identical,
 * which makes "reused the stored token" indistinguishable from "minted a fresh
 * one". Extra claims give each fixture its own identity.
 * @param deltaSeconds - Seconds from now; negative values yield a stale token.
 * @param claims - Additional payload claims to encode alongside `exp`.
 * @returns Compact JWT string.
 */
function makeJwtExpiringInWithClaims(
  deltaSeconds: number,
  claims: Readonly<Record<string, unknown>>,
): string {
  const exp = Math.floor(Date.now() / 1000) + deltaSeconds;
  return makeJwtWithClaims({ ...claims, exp });
}

export { makeJwtExpiringIn, makeJwtExpiringInWithClaims, makeJwtWithClaims };
