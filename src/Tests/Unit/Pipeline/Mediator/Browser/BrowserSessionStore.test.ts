/**
 * T-SESS — per-bank browser session persistence.
 *
 * <p>Every run launched a cold Camoufox, so banks saw a first-time visitor on
 * every request. From a datacenter IP that is the profile edge WAFs challenge:
 * Hapoalim answered our first navigation with an hCaptcha and Discount's origin
 * returned an Akamai 404, both before HOME ran a single locator.
 *
 * <p>T-SESS-1 pins the safety property that matters most: with the feature off
 * the pipeline builds exactly the context it built before. T-SESS-6 pins the
 * second: the file carries the WAF's verdict and never the bank's login, so a
 * second account at the same bank cannot inherit the first one's session.
 */

import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { BrowserContext } from 'playwright-core';

import { buildContextOptions } from '../../../../../Scrapers/Pipeline/Mediator/Browser/BrowserContextBuilder.js';
import {
  loadSessionState,
  saveSessionStateSafe,
  SESSION_ROOT_ENV,
  sessionFileFor,
} from '../../../../../Scrapers/Pipeline/Mediator/Browser/BrowserSessionStore.js';

/** One cookie as Playwright reports it, trimmed to the fields under test. */
interface IFakeCookie {
  readonly name: string;
  readonly value: string;
}

/** The persisted shape the assertions read back. */
interface IStorageShape {
  readonly cookies: readonly IFakeCookie[];
  readonly origins: readonly unknown[];
}

/**
 * A fresh, empty session root under the OS temp dir.
 * @returns Absolute path to a new directory.
 */
function freshRoot(): string {
  const base = tmpdir();
  const prefix = join(base, 'ibs-sess-');
  return mkdtempSync(prefix);
}

/**
 * A context that reports the given cookies plus a populated localStorage.
 * @param cookies - Cookies the live context would hold.
 * @returns Stand-in accepted by the store's BrowserContext parameter.
 */
function contextHolding(cookies: readonly IFakeCookie[]): BrowserContext {
  const origins = [{ origin: 'https://bank.example', localStorage: [{ name: 'jwt', value: 'x' }] }];
  const state = { cookies, origins };
  /**
   * Canned storage state.
   * @returns What this context reports.
   */
  const storageState = (): Promise<unknown> => Promise.resolve(state);
  const fake = { storageState };
  return fake as unknown as BrowserContext;
}

/**
 * Read back what the store persisted for a bank.
 * @param root - Session root directory.
 * @param companyId - Bank identifier.
 * @returns Parsed session file.
 */
function readSaved(root: string, companyId: string): IStorageShape {
  const file = join(root, `${companyId}.session.json`);
  const raw = readFileSync(file, 'utf8');
  return JSON.parse(raw) as IStorageShape;
}

/**
 * Name accessor used to compare persisted cookies.
 * @param cookie - Persisted cookie.
 * @returns Its name.
 */
function cookieName(cookie: IFakeCookie): string {
  return cookie.name;
}

describe('BrowserSessionStore — per-bank session reuse (T-SESS)', () => {
  const original = process.env[SESSION_ROOT_ENV] ?? '';

  afterEach(() => {
    process.env[SESSION_ROOT_ENV] = original;
  });

  it('T-SESS-1 (FIRING): stays off, and cold, when the root is unset', () => {
    process.env[SESSION_ROOT_ENV] = '';
    const file = sessionFileFor('hapoalim');
    const loaded = loadSessionState('hapoalim');
    const opts = buildContextOptions(loaded);
    expect({ file, loaded, hasState: 'storageState' in opts }).toEqual({
      file: false,
      loaded: false,
      hasState: false,
    });
  });

  it('T-SESS-2: keys the session per bank so cookies never cross origins', () => {
    process.env[SESSION_ROOT_ENV] = '/tmp/sessions';
    const hapoalim = sessionFileFor('hapoalim');
    const discount = sessionFileFor('discount');
    const isDistinct = hapoalim !== discount;
    const hasBoth = hapoalim !== false && discount !== false;
    expect({ isDistinct, hasBoth }).toEqual({ isDistinct: true, hasBoth: true });
  });

  it('T-SESS-3: reports no session when the bank has never been saved', () => {
    process.env[SESSION_ROOT_ENV] = '/tmp/sessions-that-do-not-exist';
    const loaded = loadSessionState('hapoalim');
    expect(loaded).toBe(false);
  });

  it('T-SESS-4: restores the saved session into the context options', () => {
    const opts = buildContextOptions('/tmp/sessions/hapoalim.session.json');
    expect(opts.storageState).toBe('/tmp/sessions/hapoalim.session.json');
  });

  it('T-SESS-5: refuses a bank key that would steer the write out of the root', () => {
    process.env[SESSION_ROOT_ENV] = '/tmp/sessions';
    const traversal = sessionFileFor('../../etc/passwd');
    const separator = sessionFileFor('hapoalim/../../evil');
    const empty = sessionFileFor('');
    expect({ traversal, separator, empty }).toEqual({
      traversal: false,
      separator: false,
      empty: false,
    });
  });

  it('T-SESS-6 (FIRING): keeps the WAF clearance and drops the bank login', async () => {
    const root = freshRoot();
    process.env[SESSION_ROOT_ENV] = root;
    const context = contextHolding([
      { name: 'cf_clearance', value: 'waf-verdict' },
      { name: '_abck', value: 'akamai-verdict' },
      { name: 'JSESSIONID', value: 'signed-in-customer' },
      { name: 'auth-token', value: 'signed-in-customer' },
    ]);
    const didWrite = await saveSessionStateSafe(context, 'hapoalim');
    const saved = readSaved(root, 'hapoalim');
    const names = saved.cookies.map(cookieName);
    expect({ didWrite, names, origins: saved.origins }).toEqual({
      didWrite: true,
      names: ['cf_clearance', '_abck'],
      origins: [],
    });
  });

  it('T-SESS-7: ignores a corrupted session file instead of replaying it', () => {
    const root = freshRoot();
    process.env[SESSION_ROOT_ENV] = root;
    const file = join(root, 'hapoalim.session.json');
    writeFileSync(file, '{ truncated', 'utf8');
    const loaded = loadSessionState('hapoalim');
    expect(loaded).toBe(false);
  });

  it('T-SESS-8: reloads a session it just wrote', async () => {
    const root = freshRoot();
    process.env[SESSION_ROOT_ENV] = root;
    const context = contextHolding([{ name: 'cf_clearance', value: 'v' }]);
    await saveSessionStateSafe(context, 'discount');
    const loaded = loadSessionState('discount');
    const expected = join(root, 'discount.session.json');
    expect(loaded).toBe(expected);
  });
});
