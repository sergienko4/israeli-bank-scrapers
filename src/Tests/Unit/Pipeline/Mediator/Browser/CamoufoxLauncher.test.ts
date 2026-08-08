/**
 * Unit tests for CamoufoxLauncher — verify static re-exports + callable shape.
 *
 * <p>The full launch path requires a real Firefox/Camoufox binary and
 * is validated in `src/Tests/E2eMocked/CamoufoxLaunch.e2e-mocked.test.ts`.
 * This file stays pure-unit: no OS process, no host-state dependency,
 * deterministic and instantaneous.
 */

import {
  CAMOUFOX_LAUNCH_TIMEOUT_ENV,
  DEFAULT_CAMOUFOX_LAUNCH_TIMEOUT_MS,
  ISRAEL_LOCALE,
  launchCamoufox,
  withLaunchBound,
  withNativeBindingDiagnostic,
} from '../../../../../Scrapers/Pipeline/Mediator/Browser/CamoufoxLauncher.js';

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

/**
 * Missing-native-binding failures camoufox-js surfaces when better-sqlite3
 * was never built — the exact strings observed on a clean Ubuntu 24.04 host
 * installed with `--ignore-scripts`.
 */
const BINDING_FAILURES = [
  'Could not locate the bindings file. Tried:',
  "Cannot find module 'better_sqlite3.node'",
  'invalid ELF header',
] as const;

describe('CamoufoxLauncher native-binding diagnostic', () => {
  it.each(BINDING_FAILURES)('replaces opaque binding failure: %s', message => {
    const enriched = withNativeBindingDiagnostic(new Error(message));
    expect(enriched).toBeInstanceOf(Error);
    expect((enriched as Error).message).toContain('npm rebuild better-sqlite3');
  });

  it('preserves the original error as cause for diagnosis', () => {
    const original = new Error('Could not locate the bindings file. Tried:');
    const enriched = withNativeBindingDiagnostic(original) as Error;
    expect(enriched.cause).toBe(original);
  });

  it('names the --ignore-scripts trigger in the remedy', () => {
    const cause = new Error('invalid ELF header');
    const enriched = withNativeBindingDiagnostic(cause) as Error;
    expect(enriched.message).toContain('--ignore-scripts');
  });

  it('passes unrelated launch errors through untouched', () => {
    const unrelated = new Error('Timeout 30000ms exceeded while launching browser');
    const passedThrough = withNativeBindingDiagnostic(unrelated);
    expect(passedThrough).toBe(unrelated);
  });

  it('passes non-Error throwables through untouched', () => {
    const thrown = { code: 'EACCES' };
    const passedThrough = withNativeBindingDiagnostic(thrown);
    expect(passedThrough).toBe(thrown);
  });
});

/**
 * The launch bound is the defence against a permanently unsettled launch
 * promise. Without it the event loop drains mid-scrape and an ESM caller
 * using top-level await dies with a bare `exit 13` and no diagnosis —
 * observed on a clean Ubuntu 24.04 host with an unbuilt native binding.
 */
describe('CamoufoxLauncher launch bound', () => {
  it('defaults to a bound generous enough for a cold-cache download', () => {
    expect(DEFAULT_CAMOUFOX_LAUNCH_TIMEOUT_MS).toBe(300_000);
  });

  it('rejects a launch that never settles instead of hanging', async () => {
    const neverSettles = new Promise<never>(() => undefined);
    const bounded = withLaunchBound(neverSettles, 5);
    await expect(bounded).rejects.toThrow(/did not finish launching within 5ms/);
  });

  it('names the override env var so the bound is escapable', async () => {
    const neverSettles = new Promise<never>(() => undefined);
    const bounded = withLaunchBound(neverSettles, 5);
    await expect(bounded).rejects.toThrow(new RegExp(CAMOUFOX_LAUNCH_TIMEOUT_ENV));
  });

  it('returns the launch result when it wins the race', async () => {
    const launched = Promise.resolve('browser');
    const bounded = withLaunchBound(launched, 30_000);
    await expect(bounded).resolves.toBe('browser');
  });

  it('propagates a genuine launch failure rather than the bound', async () => {
    const failed = Promise.reject(new Error('CannotFindXvfb'));
    const bounded = withLaunchBound(failed, 30_000);
    await expect(bounded).rejects.toThrow('CannotFindXvfb');
  });
});
