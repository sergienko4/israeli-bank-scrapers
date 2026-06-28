/**
 * Unit tests for CredentialLoader — per-bank env-var loader for the harvester.
 */

import { isSome } from '../../../../Scrapers/Pipeline/Types/Option.js';
import {
  BANK_ENV_MAP,
  hasCredentials,
  knownBanks,
  loadCredentials,
  loadOtpFromEnv,
  OTP_ENV_MAP,
} from '../../../Integration/Tools/CredentialLoader.js';

/** Snapshot of every harvester-relevant env-var captured before a test mutates them. */
type EnvSnapshot = ReadonlyMap<string, string | undefined>;

/**
 * Add all credential env-var names from the template maps to the set.
 *
 * @param all - Accumulator set to mutate.
 * @param templates - Pre-filtered (non-undefined) per-bank template maps.
 * @returns The same set after additions.
 */
function addTemplateKeys(
  all: Set<string>,
  templates: readonly Readonly<Record<string, string>>[],
): Set<string> {
  for (const tpl of templates) {
    for (const name of Object.values(tpl)) all.add(name);
  }
  return all;
}

/**
 * Add all OTP env-var names to the accumulator set.
 *
 * @param all - Accumulator set to mutate.
 * @param names - Pre-filtered (non-undefined) OTP env-var names.
 * @returns The same set after additions.
 */
function addOtpKeys(all: Set<string>, names: readonly string[]): Set<string> {
  for (const name of names) all.add(name);
  return all;
}

/**
 * Collect every env-var name referenced by the harvester maps.
 *
 * @returns Set of all credential + OTP env-var names.
 */
function collectAllEnvKeys(): Set<string> {
  const all = new Set<string>();
  const definedTemplates = Object.values(BANK_ENV_MAP).filter(
    (t): t is Readonly<Record<string, string>> => t !== undefined,
  );
  const definedOtpNames = Object.values(OTP_ENV_MAP).filter((n): n is string => n !== undefined);
  addTemplateKeys(all, definedTemplates);
  addOtpKeys(all, definedOtpNames);
  return all;
}

/**
 * Snapshot + clear every env-var the harvester reads so tests start clean.
 *
 * @returns Map of envVar → priorValue (used by {@link restoreEnv}).
 */
function snapshotAndClearEnv(): EnvSnapshot {
  const snapshot = new Map<string, string | undefined>();
  const allKeys = collectAllEnvKeys();
  allKeys.forEach(key => {
    snapshot.set(key, process.env[key]);
    Reflect.deleteProperty(process.env, key);
  });
  return snapshot;
}

/**
 * Restore an env snapshot taken with {@link snapshotAndClearEnv}.
 *
 * @param snapshot - Prior snapshot of env-var values.
 * @returns True after restoration completes (always true; satisfies return-value rule).
 */
function restoreEnv(snapshot: EnvSnapshot): boolean {
  snapshot.forEach((value, key) => {
    if (value === undefined) {
      Reflect.deleteProperty(process.env, key);
    } else {
      process.env[key] = value;
    }
  });
  return true;
}

describe('CredentialLoader', () => {
  let envSnapshot: EnvSnapshot = new Map();

  beforeEach(() => {
    envSnapshot = snapshotAndClearEnv();
  });

  afterEach(() => {
    restoreEnv(envSnapshot);
  });

  describe('knownBanks', () => {
    it('returns the eight onboarded pipeline banks sorted', () => {
      const banks = knownBanks();
      const expected = [
        'amex',
        'beinleumi',
        'discount',
        'hapoalim',
        'isracard',
        'leumi',
        'max',
        'visaCal',
      ];
      expect(banks).toEqual(expected);
    });
  });

  describe('loadCredentials', () => {
    it('loads isracard credentials from process.env', () => {
      process.env.ISRACARD_ID = '305000001';
      process.env.ISRACARD_CARD6DIGITS = '123456';
      process.env.ISRACARD_PASSWORD = 's3cret';
      const creds = loadCredentials('isracard');
      expect(creds).toEqual({ id: '305000001', card6Digits: '123456', password: 's3cret' });
    });

    it('throws when an env var is missing', () => {
      process.env.HAPOALIM_USER_CODE = 'abc';
      /**
       * Wrapper used by Jest's expect().toThrow() matcher.
       * @returns Never (loadCredentials throws).
       */
      const attempt = (): unknown => loadCredentials('hapoalim');
      expect(attempt).toThrow(/HAPOALIM_PASSWORD/u);
    });

    it('throws when an env var is whitespace-only', () => {
      process.env.MAX_USERNAME = '   ';
      process.env.MAX_PASSWORD = 'pw';
      /**
       * Wrapper used by Jest's expect().toThrow() matcher.
       * @returns Never (loadCredentials throws).
       */
      const attempt = (): unknown => loadCredentials('max');
      expect(attempt).toThrow(/MAX_USERNAME/u);
    });

    it('throws when no template is registered', () => {
      /**
       * Wrapper used by Jest's expect().toThrow() matcher.
       * @returns Never (loadCredentials throws).
       */
      const attempt = (): unknown => loadCredentials('nonexistent');
      expect(attempt).toThrow(/no credential template/u);
    });
  });

  describe('hasCredentials', () => {
    it('returns true when every required env var is present', () => {
      process.env.VISACAL_USERNAME = 'alice';
      process.env.VISACAL_PASSWORD = 'pw';
      const hasAll = hasCredentials('visaCal');
      expect(hasAll).toBe(true);
    });

    it('returns false when any env var is missing', () => {
      process.env.VISACAL_USERNAME = 'alice';
      const hasAll = hasCredentials('visaCal');
      expect(hasAll).toBe(false);
    });

    it('returns false for an unknown bank', () => {
      const hasAll = hasCredentials('nonexistent');
      expect(hasAll).toBe(false);
    });

    it('returns false when value is whitespace-only', () => {
      process.env.AMEX_ID = '';
      process.env.AMEX_CARD6DIGITS = '123456';
      process.env.AMEX_PASSWORD = 'pw';
      const hasAll = hasCredentials('amex');
      expect(hasAll).toBe(false);
    });
  });

  describe('loadOtpFromEnv', () => {
    it('returns Some(value) when BEINLEUMI_OTP is set', () => {
      process.env.BEINLEUMI_OTP = '123456';
      const optResult = loadOtpFromEnv('beinleumi');
      const isPresent = isSome(optResult);
      expect(isPresent).toBe(true);
      if (isPresent) expect(optResult.value).toBe('123456');
    });

    it('returns None when BEINLEUMI_OTP is unset', () => {
      const optResult = loadOtpFromEnv('beinleumi');
      const isPresent = isSome(optResult);
      expect(isPresent).toBe(false);
    });

    it('returns None for non-OTP banks', () => {
      const optResult = loadOtpFromEnv('isracard');
      const isPresent = isSome(optResult);
      expect(isPresent).toBe(false);
    });
  });
});
