/**
 * Auth discovery — 3-tier token extraction for the mediator.
 * Tier 1: Request headers (authorization, x-auth-token)
 * Tier 2: Response bodies of auth endpoints (WellKnown token fields)
 * Tier 3: SessionStorage fallback (generic for all banks)
 * All in the mediator — banks never know about auth.
 */

import type { Frame, Page } from 'playwright-core';

import { PIPELINE_WELL_KNOWN_API } from '../../Registry/WK/ScrapeWK.js';
import type { IDiscoveredEndpoint } from './NetworkDiscovery.js';

/** WellKnown token field names in auth response bodies. */
const TOKEN_BODY_FIELDS = ['token', 'calConnectToken', 'access_token', 'authToken', 'jwt'];

/** WellKnown sessionStorage keys for auth tokens. */
const STORAGE_AUTH_KEYS = ['auth-module', 'auth', 'token', 'session', 'guid'];

/** WellKnown request header names for auth. */
const AUTH_HEADER_NAMES = ['authorization', 'x-auth-token'];

/** Auth token string with scheme prefix (e.g. 'CALAuthScheme ...'). */
type AuthToken = string;
/** Whether an endpoint has a recognised auth header. */
type HasAuthHeader = boolean;
/** Whether an endpoint is a recognised auth endpoint. */
type IsAuthEndpoint = boolean;
/** Whether a response body value looks like a token. */
type IsTokenLike = boolean;
/** Raw sessionStorage string value or sentinel. */
type StorageValue = string;
/** CalConnect token name inside a storage auth object. */
type TokenFieldName = string;

/**
 * Add auth scheme prefix to a bare token if not already prefixed.
 * @param token - Raw token string.
 * @returns Token with CALAuthScheme or Bearer prefix.
 */
function prefixToken(token: AuthToken): AuthToken {
  if (token.startsWith('CALAuthScheme ')) return token;
  if (token.startsWith('Bearer ')) return token;
  return `CALAuthScheme ${token}`;
}

// ── Tier 1: Request Headers ────────────────────────────

/**
 * Find auth token from captured request headers.
 * @param captured - All captured endpoints.
 * @returns Auth token or false.
 */
/**
 * Check if an endpoint has an auth header.
 * @param ep - Endpoint to check.
 * @returns Auth header value or false.
 */
function extractAuthHeader(ep: IDiscoveredEndpoint): string | false {
  const hit = AUTH_HEADER_NAMES.find(
    (h): HasAuthHeader =>
      typeof ep.requestHeaders[h] === 'string' && ep.requestHeaders[h].length > 0,
  );
  if (!hit) return false;
  return ep.requestHeaders[hit];
}

/**
 * Find auth token from captured request headers.
 * @param captured - All captured endpoints.
 * @returns Auth token or false.
 */
function discoverFromHeaders(captured: readonly IDiscoveredEndpoint[]): string | false {
  const match = captured.find((ep): HasAuthHeader => extractAuthHeader(ep) !== false);
  if (!match) return false;
  return extractAuthHeader(match);
}

// ── Tier 2: Response Bodies ────────────────────────────

/**
 * Find a WellKnown token field in a flat object.
 * @param obj - Object to search.
 * @returns Prefixed token string or false.
 */
function findTokenInFlat(obj: Record<string, unknown>): string | false {
  /**
   * Check if field value is a token-length string.
   * @param f - Field name.
   * @returns True if string longer than 5 chars.
   */
  const isToken = (f: TokenFieldName): IsTokenLike => {
    const val = obj[f];
    return typeof val === 'string' && val.length > 5;
  };
  const hit = TOKEN_BODY_FIELDS.find(isToken);
  if (!hit) return false;
  return prefixToken(obj[hit] as string);
}

/**
 * Search a response body for token (flat + 1 level nested).
 * @param body - Parsed response body.
 * @returns Prefixed token or false.
 */
function searchBodyForToken(body: Record<string, unknown>): string | false {
  const direct = findTokenInFlat(body);
  if (direct) return direct;
  const nested = Object.values(body).find((v): IsTokenLike => typeof v === 'object' && v !== null);
  if (!nested) return false;
  return findTokenInFlat(nested as Record<string, unknown>);
}

/**
 * Search auth endpoint response bodies for a token.
 * @param captured - All captured endpoints.
 * @returns Prefixed token or false.
 */
function discoverFromResponses(captured: readonly IDiscoveredEndpoint[]): string | false {
  const authHits = captured.filter(
    (ep): IsAuthEndpoint =>
      PIPELINE_WELL_KNOWN_API.auth.some((p): IsAuthEndpoint => p.test(ep.url)),
  );
  /**
   * Check if endpoint response body contains a token.
   * @param ep - Captured endpoint to inspect.
   * @returns True if a token is found in the response body.
   */
  const hasToken = (ep: IDiscoveredEndpoint): IsAuthEndpoint =>
    searchBodyForToken(ep.responseBody as Record<string, unknown>) !== false;
  const match = authHits.find(hasToken);
  if (!match) return false;
  return searchBodyForToken(match.responseBody as Record<string, unknown>);
}

// ── Tier 3: SessionStorage ─────────────────────────────

/**
 * Try extracting a token from JSON sessionStorage value.
 * @param raw - Raw JSON string.
 * @returns Prefixed token or false.
 */
/** Parsed sessionStorage auth shape. */
interface IStorageAuth {
  auth?: { calConnectToken?: AuthToken; token?: AuthToken };
}

/**
 * Extract token from parsed auth JSON.
 * @param parsed - Parsed JSON object.
 * @returns Token string or false.
 */
function extractFromParsed(parsed: IStorageAuth): string | false {
  const token = parsed.auth?.calConnectToken ?? parsed.auth?.token;
  if (!token) return false;
  return prefixToken(token);
}

/**
 * Try extracting a token from JSON sessionStorage value.
 * @param raw - Raw JSON string.
 * @returns Prefixed token or false.
 */
function tryParseJsonToken(raw: string): string | false {
  try {
    const parsed = JSON.parse(raw) as { auth?: { calConnectToken?: AuthToken; token?: AuthToken } };
    return extractFromParsed(parsed);
  } catch {
    return false;
  }
}

/**
 * Read auth token from page sessionStorage.
 * @param page - Playwright page.
 * @returns Token string or false.
 */
async function discoverFromStorage(page: Page): Promise<string | false> {
  const raw = await page
    .evaluate(
      /**
       * Read first non-empty sessionStorage value from keys.
       * @param keys - Storage key names to try.
       * @returns First non-empty value or sentinel.
       */
      (keys: StorageValue[]): StorageValue => {
        const values = keys.map((k): StorageValue => sessionStorage.getItem(k) ?? '');
        const found = values.find(Boolean);
        return found ?? 'NONE';
      },
      STORAGE_AUTH_KEYS,
    )
    .catch((): StorageValue => 'NONE');
  if (raw === 'NONE') return false;
  const jsonToken = tryParseJsonToken(raw);
  if (jsonToken) return jsonToken;
  if (raw.length > 10) return raw;
  return false;
}

// ── Tier 3b: ALL Frame SessionStorages ────────────────

/**
 * Extract first valid token from a list of raw storage values.
 * @param values - Non-empty storage values from frames.
 * @returns Prefixed token or false.
 */
/**
 * Check if a single raw value is a valid token.
 * @param raw - Storage value.
 * @returns Token or false.
 */
function checkOneValue(raw: StorageValue): string | false {
  const token = tryParseJsonToken(raw);
  if (token) {
    process.stderr.write('    [AUTH] iframe token found (json)\n');
    return token;
  }
  // Raw string > 20 chars — likely a GUID/token, prefix it
  if (raw.length > 20) {
    process.stderr.write(`    [AUTH] iframe raw token: ${raw.slice(0, 20)}...\n`);
    return prefixToken(raw);
  }
  process.stderr.write(`    [AUTH] iframe raw value (short): ${raw}\n`);
  return false;
}

/**
 * Extract first valid token from a list of raw storage values.
 * @param values - Non-empty storage values from frames.
 * @returns Prefixed token or false.
 */
function extractFirstToken(values: readonly StorageValue[]): string | false {
  const hit = values.find((v): IsTokenLike => checkOneValue(v) !== false);
  if (!hit) return false;
  return checkOneValue(hit);
}

/**
 * Read sessionStorage from a single frame.
 * @param frame - Playwright frame.
 * @returns Raw storage value or sentinel.
 */
async function readFrameStorage(frame: Frame): Promise<StorageValue> {
  return frame
    .evaluate(
      /**
       * Read first non-empty sessionStorage auth value.
       * @param keys - Storage key names.
       * @returns First found value or sentinel.
       */
      (keys: StorageValue[]): StorageValue => {
        const vals = keys.map((k): StorageValue => sessionStorage.getItem(k) ?? '');
        return vals.find(Boolean) ?? 'NONE';
      },
      STORAGE_AUTH_KEYS,
    )
    .catch((): StorageValue => 'NONE');
}

/**
 * Read auth token from sessionStorage of ALL page frames (iframes).
 * Cross-origin iframes store tokens that main page can't see.
 * @param page - Playwright page.
 * @returns Token string or false.
 */
/**
 * Dump sessionStorage keys from one frame for diagnostics.
 * @param frame - Playwright frame.
 * @returns Key list string.
 */
async function dumpFrameKeys(frame: Frame): Promise<string> {
  const keys = await frame
    .evaluate((): StorageValue => {
      const allKeys = Object.keys(sessionStorage);
      return allKeys.join(', ') || 'EMPTY';
    })
    .catch((): StorageValue => 'CROSS-ORIGIN');
  const url = frame.url().slice(0, 50);
  if (keys !== 'EMPTY' && keys !== 'CROSS-ORIGIN') {
    process.stderr.write(`    [AUTH] frame ${url} keys=[${keys}]\n`);
  }
  return keys;
}

/**
 * Read auth token from sessionStorage of ALL page frames.
 * @param page - Playwright page.
 * @returns Token string or false.
 */
async function discoverFromAllFrames(page: Page): Promise<string | false> {
  const frames = page.frames();
  const dumpPromises = frames.map(dumpFrameKeys);
  await Promise.allSettled(dumpPromises);
  const storagePromises = frames.map(readFrameStorage);
  const results = await Promise.allSettled(storagePromises);
  const values = results
    .filter((r): IsTokenLike => r.status === 'fulfilled' && r.value !== 'NONE')
    .map((r): StorageValue => (r as PromiseFulfilledResult<StorageValue>).value);
  return extractFirstToken(values);
}

// ── Tier 3c: Scan ALL storage keys for tokens ────────

/**
 * Scan all sessionStorage keys in a frame for token-like JSON values.
 * Generic — no key name assumptions. Checks TOKEN_BODY_FIELDS inside values.
 * @param frame - Playwright frame.
 * @returns Token or false.
 */
/**
 * Read all JSON-like sessionStorage values from a frame.
 * @param frame - Playwright frame.
 * @returns Array of JSON strings.
 */
async function readAllJsonStorageValues(frame: Frame): Promise<readonly string[]> {
  return frame
    .evaluate((): string[] =>
      Object.keys(sessionStorage)
        .map((k): StorageValue => sessionStorage.getItem(k) ?? '')
        .filter((v): IsTokenLike => v.startsWith('{')),
    )
    .catch((): string[] => []);
}

/**
 * Scan all sessionStorage keys in a frame for token-like JSON values.
 * @param frame - Playwright frame.
 * @returns Token or false.
 */
async function scanFrameForTokens(frame: Frame): Promise<string | false> {
  const allValues = await readAllJsonStorageValues(frame);
  const tokenVal = allValues.find((v): IsTokenLike => tryParseJsonToken(v) !== false);
  if (!tokenVal) return false;
  process.stderr.write(`    [AUTH] Tier3c: token from frame ${frame.url().slice(0, 40)}\n`);
  return tryParseJsonToken(tokenVal);
}

/**
 * Tier 3c: Scan ALL storage keys across all frames for token-like values.
 * @param page - Playwright page.
 * @returns Token or false.
 */
async function discoverFromAllStorageKeys(page: Page): Promise<string | false> {
  const frames = page.frames();
  const scanPromises = frames.map(scanFrameForTokens);
  const results = await Promise.allSettled(scanPromises);
  const tokens = results
    .filter((r): IsTokenLike => r.status === 'fulfilled' && r.value !== false)
    .map((r): StorageValue => (r as PromiseFulfilledResult<string>).value);
  if (tokens.length === 0) return false;
  return tokens[0];
}

// ── Tier 4: Poll auth-module across all frames ───────

/** Max polling time for auth-module to appear (ms). */
const AUTH_POLL_TIMEOUT = 10_000;
/** Poll interval (ms). */
const AUTH_POLL_INTERVAL = 100;

/**
 * Poll all frames for auth-module until it appears or timeout.
 * Uses Playwright waitForFunction per frame — native polling, no manual setTimeout.
 * @param page - Playwright page.
 * @returns Token or false.
 */
async function pollForAuthModule(page: Page): Promise<string | false> {
  process.stderr.write('    [AUTH] polling auth-module across frames...\n');
  const startMs = Date.now();
  const frames = page.frames();
  const waiters = frames.map(
    (frame): Promise<string | false> =>
      frame
        .waitForFunction((): StorageValue => sessionStorage.getItem('auth-module') ?? '', {
          polling: AUTH_POLL_INTERVAL,
          timeout: AUTH_POLL_TIMEOUT,
        })
        .then(async (handle): Promise<string | false> => {
          const raw = await handle.jsonValue();
          if (!raw) return false;
          return tryParseJsonToken(raw);
        })
        .catch((): false => false),
  );
  const results = await Promise.allSettled(waiters);
  const tokens = results
    .filter((r): IsTokenLike => r.status === 'fulfilled' && r.value !== false)
    .map((r): StorageValue => (r as PromiseFulfilledResult<string>).value);
  if (tokens.length === 0) return false;
  const elapsed = String(Date.now() - startMs);
  process.stderr.write(`    [AUTH] auth-module found after ${elapsed}ms\n`);
  return tokens[0];
}

// ── Public: 5-tier discovery ───────────────────────────

/**
 * Discover auth token — 5 tiers:
 * 1. Request headers (authorization)
 * 2. Response bodies (token fields)
 * 3a. Main page sessionStorage
 * 3b. ALL iframe sessionStorages (instant)
 * 4. Poll auth-module across all frames (up to 30s)
 * @param captured - Captured endpoints.
 * @param page - Playwright page.
 * @returns Auth token or false.
 */
async function discoverAuthThreeTier(
  captured: readonly IDiscoveredEndpoint[],
  page: Page,
): Promise<string | false> {
  const fromBody = discoverFromResponses(captured);
  if (fromBody) return fromBody;
  const fromStorage = await discoverFromStorage(page);
  if (fromStorage) return fromStorage;
  const fromFrames = await discoverFromAllFrames(page);
  if (fromFrames) return fromFrames;
  const fromAllKeys = await discoverFromAllStorageKeys(page);
  if (fromAllKeys) return fromAllKeys;
  const fromHeaders = discoverFromHeaders(captured);
  if (fromHeaders) return fromHeaders;
  return pollForAuthModule(page);
}

export { AUTH_HEADER_NAMES, discoverAuthThreeTier, discoverFromHeaders };
