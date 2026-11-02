/**
 * Unit tests for CredentialLoader — per-bank env-var loader for the harvester.
 */

import {
  BANK_ENV_MAP,
  hasCredentials,
  knownBanks,
  loadCredentials,
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
 * Collect every env-var name referenced by the harvester maps.
 *
 * @returns Set of all credential env-var names.
 */
function collectAllEnvKeys(): Set<string> {
  const all = new Set<string>();
  const definedTemplates = Object.values(BANK_ENV_MAP).filter(
    (t): t is Readonly<Record<string, string>> => t !== undefined,
  );
  addTemplateKeys(all, definedTemplates);
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
    it('returns the two onboarded browser banks sorted', () => {
      const banks = knownBanks();
      const expected = ['discount', 'leumi'];
      expect(banks).toEqual(expected);
    });
  });

  describe('loadCredentials', () => {
    it('loads discount credentials from process.env', () => {
      process.env.DISCOUNT_ID = '305000001';
      process.env.DISCOUNT_PASSWORD = 's3cret';
      process.env.DISCOUNT_NUM = 'AB1234';
      const creds = loadCredentials('discount');
      expect(creds).toEqual({ id: '305000001', password: 's3cret', num: 'AB1234' });
    });

    it('throws when an env var is missing', () => {
      process.env.LEUMI_USERNAME = 'abc';
      /**
       * Wrapper used by Jest's expect().toThrow() matcher.
       * @returns Never (loadCredentials throws).
       */
      const attempt = (): unknown => loadCredentials('leumi');
      expect(attempt).toThrow(/LEUMI_PASSWORD/u);
    });

    it('throws when an env var is whitespace-only', () => {
      process.env.LEUMI_USERNAME = '   ';
      process.env.LEUMI_PASSWORD = 'pw';
      /**
       * Wrapper used by Jest's expect().toThrow() matcher.
       * @returns Never (loadCredentials throws).
       */
      const attempt = (): unknown => loadCredentials('leumi');
      expect(attempt).toThrow(/LEUMI_USERNAME/u);
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
      process.env.LEUMI_USERNAME = 'alice';
      process.env.LEUMI_PASSWORD = 'pw';
      const hasAll = hasCredentials('leumi');
      expect(hasAll).toBe(true);
    });

    it('returns false when any env var is missing', () => {
      process.env.LEUMI_USERNAME = 'alice';
      const hasAll = hasCredentials('leumi');
      expect(hasAll).toBe(false);
    });

    it('returns false for an unknown bank', () => {
      const hasAll = hasCredentials('nonexistent');
      expect(hasAll).toBe(false);
    });

    it('returns false when value is whitespace-only', () => {
      process.env.DISCOUNT_ID = '';
      process.env.DISCOUNT_PASSWORD = 'pw';
      process.env.DISCOUNT_NUM = 'AB1234';
      const hasAll = hasCredentials('discount');
      expect(hasAll).toBe(false);
    });
  });
});
