/**
 * Unit tests for CamoufoxLauncher — verify static re-exports + callable shape.
 *
 * <p>The full launch path requires a real Firefox/Camoufox binary and
 * is validated in `src/Tests/E2eMocked/CamoufoxLaunch.e2e-mocked.test.ts`.
 * This file stays pure-unit: no OS process, no host-state dependency,
 * deterministic and instantaneous.
 */

import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import {
  buildCloseAndStripCleanup,
  getProfileDir,
  isPersistentProfilesEnabled,
  ISRAEL_LOCALE,
  launchCamoufox,
  launchCamoufoxForBank,
  stripProfileCache,
} from '../../../../../Scrapers/Pipeline/Mediator/Browser/CamoufoxLauncher.js';

/**
 * Test-isolated home directory — passed to `getProfileDir` as the
 * explicit `homeDir` arg so assertions don't depend on the runner's
 * real `$HOME` / `%USERPROFILE%`. CodeRabbit F11 (hermetic test) +
 * `os.homedir()` is read-only ESM + Windows-cached so DI is the
 * right hermetic path.
 */
const TMP_ROOT = os.tmpdir();
const FAKE_HOME_DIR = path.join(TMP_ROOT, 'isbs-fake-home');

describe('CamoufoxLauncher module', () => {
  it('re-exports ISRAEL_LOCALE constant', () => {
    expect(ISRAEL_LOCALE).toBe('he-IL');
  });

  it('exposes launchCamoufox as an async function', () => {
    expect(typeof launchCamoufox).toBe('function');
    expect(launchCamoufox.constructor.name).toBe('AsyncFunction');
  });

  it('launchCamoufox references exist with arity 1', () => {
    expect(launchCamoufox.length).toBe(1);
  });
});

describe('getProfileDir', () => {
  it('returns <home>/.cache/isbs/profiles/<bank> for a lowercase bank', () => {
    const isResolved = getProfileDir('amex', FAKE_HOME_DIR);
    const expectedPath = path.join(FAKE_HOME_DIR, '.cache', 'isbs', 'profiles', 'amex');
    expect(isResolved).toBe(expectedPath);
  });

  it('normalises mixed-case bank identifiers to lowercase', () => {
    const isLowerDir = getProfileDir('amex', FAKE_HOME_DIR);
    const isUpperDir = getProfileDir('AMEX', FAKE_HOME_DIR);
    expect(isLowerDir).toBe(isUpperDir);
  });

  it('produces distinct paths for distinct banks', () => {
    const isAmexDir = getProfileDir('amex', FAKE_HOME_DIR);
    const isMaxDir = getProfileDir('max', FAKE_HOME_DIR);
    expect(isAmexDir).not.toBe(isMaxDir);
  });

  it('strips path-traversal characters via path.basename', () => {
    const isResolved = getProfileDir('../etc/passwd', FAKE_HOME_DIR);
    const expectedPath = path.join(FAKE_HOME_DIR, '.cache', 'isbs', 'profiles', 'passwd');
    expect(isResolved).toBe(expectedPath);
  });

  it('rejects empty bank identifier', () => {
    expect(() => getProfileDir('', FAKE_HOME_DIR)).toThrow(/Invalid bank identifier/);
  });

  it('rejects bank identifier that collapses to "."', () => {
    expect(() => getProfileDir('.', FAKE_HOME_DIR)).toThrow(/Invalid bank identifier/);
  });

  it('rejects bank identifier that collapses to ".."', () => {
    expect(() => getProfileDir('..', FAKE_HOME_DIR)).toThrow(/Invalid bank identifier/);
  });

  it('defaults to os.homedir() when no homeDir override is passed', () => {
    const isResolved = getProfileDir('amex');
    const realHome = os.homedir();
    const expectedPath = path.join(realHome, '.cache', 'isbs', 'profiles', 'amex');
    expect(isResolved).toBe(expectedPath);
  });
});

describe('isPersistentProfilesEnabled', () => {
  const wasPreviousValue = process.env.USE_PERSISTENT_PROFILES;
  afterEach(() => {
    if (wasPreviousValue === undefined) {
      delete process.env.USE_PERSISTENT_PROFILES;
    } else {
      process.env.USE_PERSISTENT_PROFILES = wasPreviousValue;
    }
  });

  it('defaults to false when env var is unset', () => {
    delete process.env.USE_PERSISTENT_PROFILES;
    const didEnable = isPersistentProfilesEnabled();
    expect(didEnable).toBe(false);
  });

  it('returns true for "true"', () => {
    process.env.USE_PERSISTENT_PROFILES = 'true';
    const didEnable = isPersistentProfilesEnabled();
    expect(didEnable).toBe(true);
  });

  it('returns true for "1" (truthy alias)', () => {
    process.env.USE_PERSISTENT_PROFILES = '1';
    const didEnable = isPersistentProfilesEnabled();
    expect(didEnable).toBe(true);
  });

  it('returns false for the literal string "false"', () => {
    process.env.USE_PERSISTENT_PROFILES = 'false';
    const didEnable = isPersistentProfilesEnabled();
    expect(didEnable).toBe(false);
  });
});

describe('stripProfileCache', () => {
  let isTmpProfile: string;

  beforeEach(() => {
    // `fs.mkdtempSync` creates an atomically-unique directory with
    // crypto-random suffix (race-free; restrictive default perms) so
    // CodeQL's "insecure temporary file" rule stays satisfied. Plain
    // `path.join(os.tmpdir(), 'fixed-name')` is flagged because two
    // concurrent test runs can race on the same path.
    const baseDir = os.tmpdir();
    const prefix = path.join(baseDir, 'isbs-strip-test-');
    isTmpProfile = fs.mkdtempSync(prefix);
  });

  afterEach(() => {
    fs.rmSync(isTmpProfile, { recursive: true, force: true });
  });

  it('removes Cache/, OfflineCache/, cache2/, crashes/ when present', () => {
    const cacheDir = path.join(isTmpProfile, 'Cache');
    const offlineDir = path.join(isTmpProfile, 'OfflineCache');
    const cache2Dir = path.join(isTmpProfile, 'cache2');
    const crashesDir = path.join(isTmpProfile, 'crashes');
    fs.mkdirSync(cacheDir);
    fs.mkdirSync(offlineDir);
    fs.mkdirSync(cache2Dir);
    fs.mkdirSync(crashesDir);
    const didStrip = stripProfileCache(isTmpProfile);
    expect(didStrip).toBe(true);
    const hasCache = fs.existsSync(cacheDir);
    const hasOffline = fs.existsSync(offlineDir);
    const hasCache2 = fs.existsSync(cache2Dir);
    const hasCrashes = fs.existsSync(crashesDir);
    expect(hasCache).toBe(false);
    expect(hasOffline).toBe(false);
    expect(hasCache2).toBe(false);
    expect(hasCrashes).toBe(false);
  });

  it('preserves cookies.sqlite and other non-cache files', () => {
    const cookiesFile = path.join(isTmpProfile, 'cookies.sqlite');
    const prefsFile = path.join(isTmpProfile, 'prefs.js');
    fs.writeFileSync(cookiesFile, 'fake-cookie-db');
    fs.writeFileSync(prefsFile, 'user_pref("x", true);');
    stripProfileCache(isTmpProfile);
    const hasCookies = fs.existsSync(cookiesFile);
    const hasPrefs = fs.existsSync(prefsFile);
    expect(hasCookies).toBe(true);
    expect(hasPrefs).toBe(true);
  });

  it('is a no-op (no throw) when the cache subdirs do not exist', () => {
    const didStrip = stripProfileCache(isTmpProfile);
    expect(didStrip).toBe(true);
  });
});

describe('launchCamoufoxForBank gating', () => {
  it('is an async function with arity 2 (headless, bank)', () => {
    expect(typeof launchCamoufoxForBank).toBe('function');
    expect(launchCamoufoxForBank.constructor.name).toBe('AsyncFunction');
    expect(launchCamoufoxForBank.length).toBe(2);
  });
});

/** Mutable record threaded into the fake launcher result. */
interface IClosedFlag {
  didClose: boolean;
}

/**
 * Build a fake launcher result that records whether `close()` was invoked.
 * Avoids `async` on the close fn because the lint rule requires `await`
 * inside async functions; we return a resolved Promise directly instead.
 * @param state - Mutable record that receives didClose=true on close.
 * @returns Fake Browser/BrowserContext stand-in.
 */
function buildFakeLaunchResult(state: IClosedFlag): unknown {
  return {
    /**
     * Mark the result as closed.
     * @returns Resolved promise.
     */
    close(): Promise<void> {
      state.didClose = true;
      return Promise.resolve();
    },
  };
}

describe('buildCloseAndStripCleanup', () => {
  const wasPreviousValue = process.env.USE_PERSISTENT_PROFILES;
  afterEach(() => {
    if (wasPreviousValue === undefined) {
      delete process.env.USE_PERSISTENT_PROFILES;
    } else {
      process.env.USE_PERSISTENT_PROFILES = wasPreviousValue;
    }
  });

  it('closes the launch result and resolves to true (ephemeral mode)', async () => {
    delete process.env.USE_PERSISTENT_PROFILES;
    const state = { didClose: false };
    const fakeResult = buildFakeLaunchResult(state) as Parameters<
      typeof buildCloseAndStripCleanup
    >[0];
    const cleanup = buildCloseAndStripCleanup(fakeResult, 'amex');
    const didFinish = await cleanup();
    expect(state.didClose).toBe(true);
    expect(didFinish).toBe(true);
  });

  it('strips the per-bank profile cache when persistent mode is enabled', async () => {
    process.env.USE_PERSISTENT_PROFILES = 'true';
    const profileDir = getProfileDir('isbs-strip-cleanup-test');
    const cache2Dir = path.join(profileDir, 'cache2');
    fs.mkdirSync(cache2Dir, { recursive: true });
    const state = { didClose: false };
    const fakeResult = buildFakeLaunchResult(state) as Parameters<
      typeof buildCloseAndStripCleanup
    >[0];
    const cleanup = buildCloseAndStripCleanup(fakeResult, 'isbs-strip-cleanup-test');
    await cleanup();
    const wasStripped = !fs.existsSync(cache2Dir);
    expect(wasStripped).toBe(true);
    fs.rmSync(profileDir, { recursive: true, force: true });
  });
});
