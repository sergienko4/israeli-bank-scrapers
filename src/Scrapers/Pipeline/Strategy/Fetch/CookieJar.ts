/**
 * Minimal Set-Cookie jar shared by the transport and the config flow: keeps
 * each cookie's name=value (same name overwrites) and emits them as one
 * `k=v; k2=v2` header. Of the attributes it honours only deletion — a
 * `Max-Age` of zero or less, or an `Expires` already past (`Max-Age` wins when
 * both are present), drops the cookie. Never logs values.
 */

/** Cookie jar — ingest Set-Cookie lines, emit one Cookie header value. */
interface ICookieJar {
  add: (setCookieLines: readonly string[]) => number;
  header: () => string;
}

/** One Set-Cookie line reduced to its pair and whether it deletes the cookie. */
interface IParsedCookie {
  readonly name: string;
  readonly value: string;
  readonly isDeletion: boolean;
}

/** A `Max-Age` value the jar reads: an optionally negative integer. */
const MAX_AGE_RE = /^-?\d+$/;

/**
 * Read one attribute's value from a Set-Cookie line; the name match is
 * case-insensitive and the last occurrence wins.
 * @param line - Raw Set-Cookie line.
 * @param name - Lower-case attribute name.
 * @returns The trimmed value, or false when the attribute is absent.
 */
function readAttribute(line: string, name: string): string | false {
  const prefix = `${name}=`;
  const attributes = line.split(';').slice(1);
  const trimmed = attributes.map((part): string => part.trim());
  const hits = trimmed.filter((part): boolean => part.toLowerCase().startsWith(prefix));
  const hit = hits.at(-1);
  if (hit === undefined) return false;
  return hit.slice(prefix.length).trim();
}

/**
 * Whether a Set-Cookie line tells the client to drop the cookie now.
 * @param line - Raw Set-Cookie line.
 * @returns True for `Max-Age<=0`, or (without a `Max-Age`) a past `Expires`.
 */
function isDeletionLine(line: string): boolean {
  const maxAge = readAttribute(line, 'max-age');
  if (maxAge !== false && MAX_AGE_RE.test(maxAge)) return Number(maxAge) <= 0;
  const expires = readAttribute(line, 'expires');
  if (expires === false) return false;
  const expiresAt = Date.parse(expires);
  return expiresAt <= Date.now();
}

/**
 * Parse a single Set-Cookie line when valid.
 * @param line - Raw Set-Cookie line.
 * @returns The parsed cookie, or false when malformed.
 */
function parseCookieLine(line: string): IParsedCookie | false {
  const kv = line.split(';', 1)[0];
  const eq = kv.indexOf('=');
  if (eq <= 0) return false;
  const name = kv.slice(0, eq).trim();
  if (name.length === 0) return false;
  const value = kv.slice(eq + 1).trim();
  return { name, value, isDeletion: isDeletionLine(line) };
}

/**
 * Store one parsed cookie, or drop it when the line deletes it.
 * @param jar - Backing map.
 * @param cookie - Parsed cookie.
 * @returns True when the jar changed.
 */
function storeCookie(jar: Map<string, string>, cookie: IParsedCookie): boolean {
  if (cookie.isDeletion) return jar.delete(cookie.name);
  jar.set(cookie.name, cookie.value);
  return true;
}

/**
 * Add all Set-Cookie lines into the jar (duplicates overwrite).
 * @param jar - Backing map.
 * @param setCookieLines - Raw Set-Cookie lines.
 * @returns Updated jar size.
 */
function ingestCookies(jar: Map<string, string>, setCookieLines: readonly string[]): number {
  const parsed = setCookieLines
    .map(parseCookieLine)
    .filter((cookie): cookie is IParsedCookie => cookie !== false);
  for (const cookie of parsed) storeCookie(jar, cookie);
  return jar.size;
}

/**
 * Emit the `k=v; k2=v2` cookie header string from the jar.
 * @param jar - Backing map.
 * @returns Joined cookie header.
 */
function emitCookieHeader(jar: Map<string, string>): string {
  const jarEntries = jar.entries();
  const entries = Array.from(jarEntries);
  const pairs = entries.map(([name, value]): string => `${name}=${value}`);
  return pairs.join('; ');
}

/**
 * Bind the cookie-jar add method to a backing map.
 * @param jar - Backing cookie map.
 * @returns Add function.
 */
function bindJarAdd(jar: Map<string, string>): (lines: readonly string[]) => number {
  return (lines): number => ingestCookies(jar, lines);
}

/**
 * Bind the cookie-jar header method to a backing map.
 * @param jar - Backing cookie map.
 * @returns Header function.
 */
function bindJarHeader(jar: Map<string, string>): () => string {
  return (): string => emitCookieHeader(jar);
}

/**
 * Minimal cookie jar — stores last-seen Set-Cookie lines and emits
 * a `k=v; …` header on demand. Duplicate names overwrite.
 * @returns Cookie jar implementation.
 */
function createSimpleCookieJar(): ICookieJar {
  const jar = new Map<string, string>();
  return { add: bindJarAdd(jar), header: bindJarHeader(jar) };
}

export type { ICookieJar };
export { createSimpleCookieJar };
