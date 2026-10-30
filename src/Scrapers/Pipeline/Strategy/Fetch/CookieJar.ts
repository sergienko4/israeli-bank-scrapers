/**
 * Minimal Set-Cookie jar shared by the transport and the config flow: keeps
 * each cookie's name=value (attributes ignored, same name overwrites) and
 * emits them as one `k=v; k2=v2` header. Never logs values.
 */

/** Cookie jar — ingest Set-Cookie lines, emit one Cookie header value. */
interface ICookieJar {
  add: (setCookieLines: readonly string[]) => number;
  header: () => string;
}

/**
 * Parse a single Set-Cookie line into a [name, value] pair when valid.
 * @param line - Raw Set-Cookie line (first segment before `;`).
 * @returns Tuple or false when malformed.
 */
function parseCookieLine(line: string): readonly [string, string] | false {
  const kv = line.split(';', 1)[0];
  const eq = kv.indexOf('=');
  if (eq <= 0) return false;
  const name = kv.slice(0, eq).trim();
  const value = kv.slice(eq + 1).trim();
  if (name.length === 0) return false;
  return [name, value] as const;
}

/**
 * Add all Set-Cookie lines into the jar (duplicates overwrite).
 * @param jar - Backing map.
 * @param setCookieLines - Raw Set-Cookie lines.
 * @returns Updated jar size.
 */
function ingestCookies(jar: Map<string, string>, setCookieLines: readonly string[]): number {
  const parsedPairs = setCookieLines
    .map(parseCookieLine)
    .filter((p): p is readonly [string, string] => p !== false);
  for (const [name, value] of parsedPairs) jar.set(name, value);
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
