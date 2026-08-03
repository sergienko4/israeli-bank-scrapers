/**
 * BrowserSessionStore — per-bank browser session persistence.
 *
 * <p>A fresh Camoufox launch carries no cookies, so every run arrives at the
 * bank as a first-time visitor. From a datacenter IP that is exactly the
 * profile edge WAFs challenge: Hapoalim answered our first navigation with an
 * hCaptcha before HOME ran a single locator, and Discount's origin returned an
 * Akamai 404. Restoring the previous run's storage state presents the WAF's own
 * clearance cookie instead, so the origin sees a returning visitor.
 *
 * <p>Opt-in: with {@link SESSION_ROOT_ENV} unset every helper reports "no
 * session" and the pipeline behaves exactly as before. The state file holds
 * live session cookies — it is written outside the repo and must never be
 * committed.
 */

import { existsSync } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';

import type { BrowserContext } from 'playwright-core';

/** Env var naming the directory that holds per-bank session files. */
const SESSION_ROOT_ENV = 'BROWSER_SESSION_ROOT';

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
 * Session file for one bank. Keyed per bank so one origin's cookies can never
 * be presented to another.
 * @param companyId - Bank identifier.
 * @returns Absolute-or-relative file path, or false when the feature is off.
 */
function sessionFileFor(companyId: string): string | false {
  const root = sessionRoot();
  if (root === false) return false;
  return join(root, `${companyId}.session.json`);
}

/**
 * Path to a previously saved session, when one exists.
 * @param companyId - Bank identifier.
 * @returns Path Playwright can load as `storageState`, else false.
 */
function loadSessionState(companyId: string): string | false {
  const file = sessionFileFor(companyId);
  if (file === false) return false;
  if (!existsSync(file)) return false;
  return file;
}

/**
 * Persist the context's cookies for the next run. Best-effort: a failed write
 * must never fail a scrape that already succeeded.
 * @param context - Live browser context.
 * @param companyId - Bank identifier.
 * @returns True when a session file was written.
 */
async function saveSessionState(context: BrowserContext, companyId: string): Promise<boolean> {
  const file = sessionFileFor(companyId);
  if (file === false) return false;
  const folder = dirname(file);
  await mkdir(folder, { recursive: true });
  await context.storageState({ path: file });
  return true;
}

/**
 * {@link saveSessionState} with writes swallowed.
 * @param context - Live browser context.
 * @param companyId - Bank identifier.
 * @returns True when a session file was written, false on any failure.
 */
async function saveSessionStateSafe(context: BrowserContext, companyId: string): Promise<boolean> {
  return saveSessionState(context, companyId).catch((): false => false);
}

export { loadSessionState, saveSessionStateSafe, SESSION_ROOT_ENV, sessionFileFor };
