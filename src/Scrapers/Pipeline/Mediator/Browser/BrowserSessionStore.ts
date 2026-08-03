/**
 * BrowserSessionStore — per-bank WAF clearance persistence.
 *
 * <p>A fresh Camoufox launch carries no cookies, so every run arrives at the
 * bank as a first-time visitor. From a datacenter IP that is exactly the
 * profile edge WAFs challenge: Hapoalim answered our first navigation with an
 * hCaptcha before HOME ran a single locator, and Discount's origin returned an
 * Akamai 404. Replaying the previous run's clearance cookie presents the WAF
 * its own verdict instead, so the origin sees a returning visitor.
 *
 * <p>Only the WAF's own cookies are kept. A bank's post-login cookies identify
 * a signed-in customer, and this file is keyed by bank alone — persisting them
 * would hand the next run for a different account at the same bank someone
 * else's session. {@link WAF_COOKIE_PREFIXES} draws that line, and `origins`
 * is written empty because localStorage is where banks park their tokens.
 *
 * <p>Opt-in: with {@link SESSION_ROOT_ENV} unset every helper reports "no
 * session" and the pipeline behaves exactly as before. The file is written
 * outside the repo and must never be committed.
 */

import { randomUUID } from 'node:crypto';
import { lstatSync, readFileSync } from 'node:fs';
import { chmod, mkdir, rename, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

import type { BrowserContext } from 'playwright-core';

/** Env var naming the directory that holds per-bank session files. */
const SESSION_ROOT_ENV = 'BROWSER_SESSION_ROOT';

/**
 * Bank identifiers are enum tokens ('hapoalim', 'max'). This layer receives a
 * bare string, so an untyped caller could otherwise steer the write with
 * separators or '..'. Allow-list the token before it reaches a path.
 */
const SAFE_COMPANY_ID = /^[\w-]+$/;

/** Owner-only, so a shared host cannot read another user's clearance. */
const SESSION_DIR_MODE = 0o700;
const SESSION_FILE_MODE = 0o600;

/**
 * Cookie names the edge WAFs set to record "this browser already passed".
 * Matched as prefixes because several vendors suffix a site or session id.
 */
const WAF_COOKIE_PREFIXES: readonly string[] = [
  'cf_clearance', // Cloudflare — challenge clearance
  '__cf_bm', // Cloudflare — bot management
  '_abck', // Akamai Bot Manager — sensor verdict
  'ak_bmsc', // Akamai — session
  'bm_s', // Akamai — bm_sz / bm_sv
  'bm_mi', // Akamai — mid-session
  'visid_incap_', // Imperva — visitor id
  'incap_ses_', // Imperva — session
  'nlbi_', // Imperva — load balancer affinity
  '_px', // PerimeterX — _px / _pxhd / _px3
  'hc_accessibility', // hCaptcha — accessibility pass
];

/** Exactly the shape Playwright hands back, and expects to be handed. */
type StorageState = Awaited<ReturnType<BrowserContext['storageState']>>;

/** One entry of that state's cookie jar, with every field Playwright requires. */
type SavedCookie = StorageState['cookies'][number];

/** The one cookie field the allow-list reads. */
interface INamedCookie {
  readonly name: string;
}

/**
 * Directory holding session files, or false when the feature is off.
 * @returns Configured root, or false when unset/empty.
 */
function sessionRoot(): string | false {
  const root = process.env[SESSION_ROOT_ENV];
  if (root === undefined || root.length === 0) return false;
  return root;
}

/**
 * Session file for one bank. Keyed per bank so one origin's clearance can
 * never be presented to another.
 * @param companyId - Bank identifier.
 * @returns File path, or false when the feature is off or the key is unsafe.
 */
function sessionFileFor(companyId: string): string | false {
  const root = sessionRoot();
  if (root === false) return false;
  if (!SAFE_COMPANY_ID.test(companyId)) return false;
  return join(root, `${companyId}.session.json`);
}

/**
 * Whether the path is a regular file. `lstat` does not follow links, so a
 * symlink planted at the path is rejected rather than read through.
 * @param file - Candidate session path.
 * @returns True when the path is a regular file.
 */
function isRegularFile(file: string): boolean {
  const stats = lstatSync(file, { throwIfNoEntry: false });
  return stats?.isFile() === true;
}

/**
 * Parse a file without letting a bad one throw.
 * @param file - Candidate session path.
 * @returns Parsed value, or false when the file is unreadable or not JSON.
 */
function readJsonSafely(file: string): unknown {
  try {
    const raw = readFileSync(file, 'utf8');
    return JSON.parse(raw) as unknown;
  } catch {
    return false;
  }
}

/**
 * Whether the value is one cookie Playwright will accept back.
 *
 * <p>`newContext` reads every entry, so one malformed element strands the run
 * just as surely as an unparseable file.
 * @param value - Candidate cookie entry.
 * @returns True when the entry carries the fields Playwright requires.
 */
function isCookieEntry(value: unknown): boolean {
  if (typeof value !== 'object' || value === null) return false;
  const cookie = value as Partial<SavedCookie>;
  const isNamed = typeof cookie.name === 'string' && typeof cookie.value === 'string';
  return isNamed && typeof cookie.domain === 'string' && typeof cookie.path === 'string';
}

/**
 * Whether the file still parses as the shape Playwright will be handed. A
 * truncated or hand-edited file would otherwise throw inside `newContext`
 * and strand every later run behind the same bad state.
 * @param file - Candidate session path.
 * @returns True when the file parses and carries a cookie array.
 */
function holdsSessionState(file: string): boolean {
  const parsed = readJsonSafely(file);
  if (typeof parsed !== 'object' || parsed === null) return false;
  const state = parsed as Partial<StorageState>;
  if (!Array.isArray(state.cookies)) return false;
  return state.cookies.every(isCookieEntry);
}

/**
 * Path to a previously saved session, when one exists and is still usable.
 * @param companyId - Bank identifier.
 * @returns Path Playwright can load as `storageState`, else false.
 */
function loadSessionState(companyId: string): string | false {
  const file = sessionFileFor(companyId);
  if (file === false) return false;
  if (!isRegularFile(file)) return false;
  if (!holdsSessionState(file)) return false;
  return file;
}

/**
 * Whether the cookie is one an edge WAF set to record a passed challenge.
 * @param cookie - Cookie from the live context.
 * @returns True when the name matches the allow-list.
 */
function isWafCookie(cookie: INamedCookie): boolean {
  return WAF_COOKIE_PREFIXES.some((prefix): boolean => cookie.name.startsWith(prefix));
}

/**
 * Stage the payload in a fresh owner-only file beside the target.
 *
 * <p>The `mode` argument only applies to a file being created, which is why
 * the temp name has to be unique on every save.
 * @param file - Destination session path.
 * @param state - Cookies to persist.
 * @returns Path of the temp file now holding the payload.
 */
async function writeTempFile(file: string, state: StorageState): Promise<string> {
  const unique = randomUUID();
  const temp = `${file}.${unique}.tmp`;
  const payload = JSON.stringify(state);
  await writeFile(temp, payload, { mode: SESSION_FILE_MODE });
  return temp;
}

/**
 * Replace the session file atomically, owner-only.
 *
 * <p>Written under a fresh name and renamed over the target: `rename` replaces
 * whatever sits at the path rather than following it, so a planted symlink
 * cannot redirect the write and no reader observes a half-written file. The
 * directory is chmod'd separately because `mkdir`'s mode is ignored for a
 * directory that already exists.
 * @param file - Destination session path.
 * @param state - Cookies to persist.
 * @returns True once the file is in place.
 */
async function writeSessionFile(file: string, state: StorageState): Promise<boolean> {
  const folder = dirname(file);
  await mkdir(folder, { recursive: true, mode: SESSION_DIR_MODE });
  await chmod(folder, SESSION_DIR_MODE);
  const temp = await writeTempFile(file, state);
  await rename(temp, file);
  return true;
}

/**
 * Persist the WAF's clearance for the next run, and nothing else.
 * @param context - Live browser context.
 * @param companyId - Bank identifier.
 * @returns True when a session file was written.
 */
async function saveSessionState(context: BrowserContext, companyId: string): Promise<boolean> {
  const file = sessionFileFor(companyId);
  if (file === false) return false;
  const live = await context.storageState();
  const cookies = live.cookies.filter(isWafCookie);
  return writeSessionFile(file, { cookies, origins: [] });
}

/**
 * {@link saveSessionState} with writes swallowed: a failed save must never
 * fail a scrape that already succeeded.
 * @param context - Live browser context.
 * @param companyId - Bank identifier.
 * @returns True when a session file was written, false on any failure.
 */
async function saveSessionStateSafe(context: BrowserContext, companyId: string): Promise<boolean> {
  return saveSessionState(context, companyId).catch((): false => false);
}

/**
 * Whether session persistence is configured at all. Lets callers tell "the
 * feature is off" apart from "the save failed" — without it every run with
 * the feature disabled would report a failed cleanup.
 * @returns True when a session root is set.
 */
function isSessionEnabled(): boolean {
  return sessionRoot() !== false;
}

export {
  isSessionEnabled,
  loadSessionState,
  saveSessionStateSafe,
  SESSION_ROOT_ENV,
  sessionFileFor,
};
