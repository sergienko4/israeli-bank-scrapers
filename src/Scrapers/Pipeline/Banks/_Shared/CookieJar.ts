/**
 * Generic host-scoped cookie jar — used by any bank whose auth
 * flow depends on echoing Set-Cookie values on subsequent requests.
 * Zero bank-specific coupling (Rule #11).
 * Attribute-stripping parser: everything after the first ";" is
 * ignored (Expires/Path/Domain/Secure/HttpOnly/SameSite).
 */

/** Attribute-stripped "name=value" head of a Set-Cookie line. */
type CookieHead = string;
/** Serialized "name1=v1; name2=v2" Cookie request-header value. */
type CookieHeaderValue = string;
/** Count of entries stored in the cookie jar. */
type CookieStoreSize = number;
/** Count of Set-Cookie lines successfully ingested. */
type IngestedCount = number;

/** Parsed (name, value) pair from a single Set-Cookie line. */
interface ICookieEntry {
  readonly name: string;
  readonly value: string;
}

/** Public contract consumers see. */
export interface ICookieJar {
  readonly add: (setCookieHeaders: readonly string[]) => number;
  readonly cookieHeader: () => string;
  readonly size: () => number;
}

/**
 * Strip Set-Cookie attributes — return the "name=value" head only.
 * @param raw - Raw Set-Cookie value, attributes optional.
 * @returns Head string (everything before the first ";").
 */
function stripAttributes(raw: string): CookieHead {
  const trimmed = raw.trim();
  const semi = trimmed.indexOf(';');
  if (semi === -1) return trimmed;
  return trimmed.slice(0, semi);
}

/**
 * Split one Set-Cookie value into (name, value) or false when malformed.
 * @param raw - Raw Set-Cookie value, attributes optional.
 * @returns ICookieEntry or false.
 */
function parseOne(raw: string): ICookieEntry | false {
  const head = stripAttributes(raw);
  if (head === '') return false;
  const eq = head.indexOf('=');
  if (eq <= 0) return false;
  return { name: head.slice(0, eq), value: head.slice(eq + 1) };
}

/**
 * Ingest one Set-Cookie line into the store if well-formed.
 * @param store - Underlying Map (mutated).
 * @param raw - Raw Set-Cookie value.
 * @returns 1 if stored, 0 if ignored.
 */
function ingestOne(store: Map<string, string>, raw: string): IngestedCount {
  const parsed = parseOne(raw);
  if (parsed === false) return 0;
  store.set(parsed.name, parsed.value);
  return 1;
}

/**
 * Ingest every raw Set-Cookie line into the store (last-wins per name).
 * @param store - Underlying Map (mutated).
 * @param lines - Raw Set-Cookie lines.
 * @returns Count of stored entries after ingest.
 */
function ingestAll(store: Map<string, string>, lines: readonly string[]): CookieStoreSize {
  for (const line of lines) ingestOne(store, line);
  return store.size;
}

/**
 * Serialize the store as a single Cookie header value.
 * @param store - Underlying Map.
 * @returns "name1=v1; name2=v2; …" (empty when store is empty).
 */
function serializeHeader(store: Map<string, string>): CookieHeaderValue {
  const parts: string[] = [];
  for (const [name, value] of store) parts.push(`${name}=${value}`);
  return parts.join('; ');
}

/**
 * Current entry count in the store.
 * @param store - Underlying Map.
 * @returns Size.
 */
function jarSize(store: Map<string, string>): CookieStoreSize {
  return store.size;
}

/**
 * Build ICookieJar.add bound to the given store.
 * @param store - Underlying Map.
 * @returns Add operation.
 */
function bindAdd(store: Map<string, string>): ICookieJar['add'] {
  return (lines): CookieStoreSize => ingestAll(store, lines);
}

/**
 * Build ICookieJar.cookieHeader bound to the given store.
 * @param store - Underlying Map.
 * @returns cookieHeader operation.
 */
function bindCookieHeader(store: Map<string, string>): ICookieJar['cookieHeader'] {
  return (): CookieHeaderValue => serializeHeader(store);
}

/**
 * Build ICookieJar.size bound to the given store.
 * @param store - Underlying Map.
 * @returns size operation.
 */
function bindSize(store: Map<string, string>): ICookieJar['size'] {
  return (): CookieStoreSize => jarSize(store);
}

/**
 * Create a fresh in-memory cookie jar. State lives in the closure;
 * two jars are fully independent.
 * @returns ICookieJar instance.
 */
export function createCookieJar(): ICookieJar {
  const store = new Map<string, string>();
  return { add: bindAdd(store), cookieHeader: bindCookieHeader(store), size: bindSize(store) };
}
