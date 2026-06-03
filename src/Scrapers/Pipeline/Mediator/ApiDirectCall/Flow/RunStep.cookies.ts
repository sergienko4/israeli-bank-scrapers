/**
 * Cookie-jar implementation + on-set-cookie sink builder.
 */

import type { IRunStepArgs, IStepCookieJar, OnSetCookie } from './RunStep.types.js';

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
function createSimpleCookieJar(): IStepCookieJar {
  const jar = new Map<string, string>();
  return { add: bindJarAdd(jar), header: bindJarHeader(jar) };
}

/**
 * Forward Set-Cookie lines to a bound jar.
 * @param jar - Bound cookie jar instance.
 * @returns Cookie-sink callback.
 */
function bindJarSink(jar: IStepCookieJar): OnSetCookie {
  return (cookies): number => jar.add(cookies);
}

/**
 * Resolve the optional Set-Cookie sink for this step.
 * @param args - Run-step args.
 * @returns Callback when a jar is configured; false otherwise.
 */
function buildOnSetCookie(args: IRunStepArgs): OnSetCookie | false {
  if (!args.step.cookieJar) return false;
  if (args.cookieJar === undefined) return false;
  return bindJarSink(args.cookieJar);
}

export { buildOnSetCookie, createSimpleCookieJar };
