/**
 * Cross-bank invariants for the warm-start contract (issue #576).
 *
 * Warm start lets a caller skip the SMS chain by replaying a stored token.
 * Whether that stays safe depends on properties no single bank config can
 * assert about itself, so they are pinned here once for every bank that opts
 * in.
 *
 * The invariant that matters most is the freshness gate. Without `jwtClaims`,
 * `pickWarmSeed` cannot tell a live token from a dead one, so staleness is
 * discovered only by the bank — which costs a round-trip, leaves
 * `classifyLoginKind` permanently reporting `stored-jwt-stale`, and makes an
 * expired warm path indistinguishable from a healthy one. OneZero shipped
 * without this gate, which is how issue #576 stayed invisible.
 *
 * Uses dynamic imports for `Registry/Config/*` per the project's test
 * architectural rule (Pipeline tests don't statically import from
 * Registry/Config).
 */

import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import type {
  IApiDirectCallConfig,
  IBoundDeviceAuthConfig,
  IDeviceMemoryAuthConfig,
  IStepConfig,
} from '../../../../Scrapers/Pipeline/Mediator/ApiDirectCall/ConfigContracts/index.js';
import { authPolicyOf } from '../../../../Scrapers/Pipeline/Mediator/ApiDirectCall/Flow/AuthModePolicy.js';
import {
  boundWarmOf,
  carryBundleWarmOf,
  cookieJarWarmOf,
  warmCarryField,
} from '../../../../Scrapers/Pipeline/Mediator/ApiDirectCall/Flow/WarmStartKind.js';
import { writesOf } from './CarrySlotWriters.js';

/** Bank label paired with the module path of its call-config literal. */
const CONFIG_PATHS: readonly (readonly [string, string])[] = [
  ['OneZero', '../../../../Scrapers/Pipeline/Registry/Config/PipelineBankConfigOneZero.js'],
  ['Pepper', '../../../../Scrapers/Pipeline/Registry/Config/PipelineBankConfigPepper.js'],
  ['PayBox', '../../../../Scrapers/Pipeline/Registry/Config/PipelineBankConfigPayBox.js'],
  ['VisaCal', '../../../../Scrapers/Pipeline/Registry/Config/PipelineBankConfigVisaCal.js'],
  ['Isracard', '../../../../Scrapers/Pipeline/Registry/Config/PipelineBankConfigIsracard.js'],
  ['Amex', '../../../../Scrapers/Pipeline/Registry/Config/PipelineBankConfigAmex.js'],
  ['Hapoalim', '../../../../Scrapers/Pipeline/Registry/Config/PipelineBankConfigHapoalim.js'],
  ['Yahav', '../../../../Scrapers/Pipeline/Registry/Config/PipelineBankConfigYahav.js'],
  ['Beinleumi', '../../../../Scrapers/Pipeline/Registry/Config/PipelineBankConfigBeinleumi.js'],
  ['Massad', '../../../../Scrapers/Pipeline/Registry/Config/PipelineBankConfigMassad.js'],
];

/** Directory holding every bank call-config literal. */
const CONFIG_DIR = fileURLToPath(
  new URL('../../../../Scrapers/Pipeline/Registry/Config/', import.meta.url),
);

/**
 * Config files this suite knows about. Derived drift against the directory is
 * a failure: a warm-start bank that never reaches {@link CONFIG_PATHS} would
 * otherwise be invisible to every invariant below. The ring issuers share one
 * factory file, so `PipelineBankConfigRing.ts` stands for each of them.
 */
const EXPECTED_WARM_START_FILES: readonly string[] = [
  'PipelineBankConfigHapoalim.ts',
  'PipelineBankConfigOneZero.ts',
  'PipelineBankConfigPayBox.ts',
  'PipelineBankConfigPepper.ts',
  'PipelineBankConfigRing.ts',
  'PipelineBankConfigVisaCal.ts',
  'PipelineBankConfigYahav.ts',
];

/**
 * Read one config file and report its name when it declares a warmStart block.
 * @param name - File name inside {@link CONFIG_DIR}.
 * @returns The file name when it opts into warm start, empty string otherwise.
 */
async function nameIfWarmStart(name: string): Promise<string> {
  const filePath = join(CONFIG_DIR, name);
  const source = await readFile(filePath, 'utf8');
  return source.includes('warmStart:') ? name : '';
}

/**
 * Scan the config directory for every bank that opts into warm start.
 *
 * Deriving the population from disk — rather than trusting the hardcoded
 * {@link CONFIG_PATHS} list — is what makes this suite self-extending.
 * @returns Sorted file names declaring a warmStart block.
 */
async function findWarmStartConfigFiles(): Promise<readonly string[]> {
  const entries = await readdir(CONFIG_DIR);
  const candidates = entries.filter(
    name => name.startsWith('PipelineBankConfig') && name.endsWith('.ts'),
  );
  const pending = candidates.map(nameIfWarmStart);
  const flagged = await Promise.all(pending);
  return flagged.filter(name => name.length > 0).sort();
}

/**
 * A warm start the bank itself validates, on a cookie session. Its token has
 * no readable expiry (`validation: 'bank-call'`, no `jwtClaims`) and no step
 * yields a header token (`authScheme: 'none'`), so it pins that both
 * policy-dependent invariants below exempt such a config while every other
 * invariant still holds for it.
 */
const COOKIE_SESSION_FIXTURE: IApiDirectCallConfig = {
  flow: 'sms-otp',
  envelope: {},
  authScheme: 'none',
  warmStart: {
    credsField: 'otpLongTermToken',
    carryField: 'hash',
    fromStepIndex: 1,
    validation: 'bank-call',
  },
  steps: [
    {
      name: 'login',
      urlTag: 'auth.login',
      body: { shape: { x: { $literal: 1 } } },
      extractsToCarry: { hash: '/data/hash' },
    },
    {
      name: 'validate',
      urlTag: 'auth.assert',
      body: { shape: { hash: { $ref: 'carry.hash' } } },
      extractsToCarry: { userName: '/data/userName' },
    },
  ],
};

/**
 * Whether the stored token is judged by its JWT expiry before reuse.
 * @param config - Bank call-config literal.
 * @returns True for `'jwt'` validation, the default.
 */
function isJwtValidated(config: IApiDirectCallConfig): boolean {
  const validation = config.warmStart?.validation ?? 'jwt';
  return validation === 'jwt';
}

/**
 * Whether the auth-mode policy sends the login token as a header.
 * @param config - Bank call-config literal.
 * @returns True when the scheme installs an Authorization header.
 */
function isHeaderSent(config: IApiDirectCallConfig): boolean {
  return authPolicyOf(config).installHeader;
}

/**
 * Whether the stored token is the session jar rather than a carry slot.
 * @param config - Bank call-config literal.
 * @returns True for a `kind: 'cookie-jar'` warm start.
 */
function isJarToken(config: IApiDirectCallConfig): boolean {
  return cookieJarWarmOf(config) !== false;
}

/**
 * Whether the stored token is a bundle of carry slots.
 * @param config - Bank call-config literal.
 * @returns True for a `kind: 'carry-bundle'` warm start.
 */
function isBundleToken(config: IApiDirectCallConfig): boolean {
  return carryBundleWarmOf(config) !== false;
}

/**
 * Whether the stored token is one carry slot, unbound to an account.
 * @param config - Bank call-config literal.
 * @returns True when the warm start is neither a jar nor a bundle.
 */
function isCarryToken(config: IApiDirectCallConfig): boolean {
  return boundWarmOf(config) === false;
}

/** Module shape shared by every call-config literal — default export. */
interface IConfigModule {
  readonly default: IApiDirectCallConfig;
}

/**
 * Load one bank's call-config literal via the permitted dynamic-import hatch.
 * @param path - Module path of the config literal.
 * @returns Promise resolving to the config.
 */
async function loadConfig(path: string): Promise<IApiDirectCallConfig> {
  const mod = (await import(path)) as IConfigModule;
  return mod.default;
}

/**
 * Collect every bank whose config declares a warmStart block.
 * @returns Label/config pairs for warm-start banks.
 */
async function loadWarmStartConfigs(): Promise<
  readonly (readonly [string, IApiDirectCallConfig])[]
> {
  const pending = CONFIG_PATHS.map(async ([label, path]) => {
    const config = await loadConfig(path);
    return [label, config] as const;
  });
  const loaded = await Promise.all(pending);
  return loaded.filter(([, config]) => config.warmStart !== undefined);
}

/**
 * Every warm-start bank plus the cookie-session fixture.
 * @returns Label/config pairs every warm invariant must hold for.
 */
async function loadWarmPopulation(): Promise<readonly (readonly [string, IApiDirectCallConfig])[]> {
  const banks = await loadWarmStartConfigs();
  return [...banks, ['cookie-session fixture', COOKIE_SESSION_FIXTURE]];
}

/**
 * Index of the last step that collects an OTP code, or -1 when none does.
 *
 * <p>The bank sends the message at or before the step whose pre-hook asks for
 * the code, so resuming strictly after this index is what makes a warm start
 * provably free of SMS traffic. The cold-flow budget
 * (`TokenStrategyFromConfig.budget.ts`) exempts warm resumes from its cap on
 * exactly that assumption; this is where the assumption is enforced rather
 * than trusted.
 * @param config - Bank call-config literal.
 * @returns Highest OTP pre-hook step index, or -1.
 */
function lastOtpPreHookIndex(config: IApiDirectCallConfig): number {
  const otpSteps = config.steps.map((step, index) =>
    step.preHook?.awaitCredsField === 'otpCodeRetriever' ? index : -1,
  );
  return Math.max(...otpSteps, -1);
}

/** A bank label, its config and its bound-device block. */
type BoundDeviceEntry = readonly [string, IApiDirectCallConfig, IBoundDeviceAuthConfig];

/**
 * Keep a bank only when its persistent-auth block is bound-device.
 * @param label - Bank label.
 * @param config - Bank call config.
 * @returns The entry, or none.
 */
function boundDeviceEntryOf(label: string, config: IApiDirectCallConfig): BoundDeviceEntry[] {
  const block = config.persistentAuth;
  if (block?.kind !== 'bound-device') return [];
  return [[label, config, block]];
}

/**
 * Collect every bank whose config declares a bound-device persistentAuth block.
 * @returns Label/config/block entries for bound-device banks.
 */
async function loadPersistentAuthConfigs(): Promise<readonly BoundDeviceEntry[]> {
  const pending = CONFIG_PATHS.map(async ([label, path]) => {
    const config = await loadConfig(path);
    return [label, config] as const;
  });
  const loaded = await Promise.all(pending);
  return loaded.flatMap(([label, config]) => boundDeviceEntryOf(label, config));
}

describe('warm-start contract — every opted-in bank', () => {
  it('covers exactly the warm-start banks present on disk', async () => {
    const files = await findWarmStartConfigFiles();
    expect(files).toEqual([...EXPECTED_WARM_START_FILES]);
  });

  it('loads every bank this suite enumerates', async () => {
    const configs = await loadWarmStartConfigs();
    const labels = configs.map(([label]) => label);
    const expected = [
      'OneZero',
      'Pepper',
      'PayBox',
      'VisaCal',
      'Isracard',
      'Amex',
      'Hapoalim',
      'Yahav',
    ];
    expect(labels).toEqual(expected);
  });

  it('holds every invariant below to the cookie-session fixture too', async () => {
    const configs = await loadWarmPopulation();
    const labels = configs.map(([label]) => label);
    const expected = [
      'OneZero',
      'Pepper',
      'PayBox',
      'VisaCal',
      'Isracard',
      'Amex',
      'Hapoalim',
      'Yahav',
      'cookie-session fixture',
    ];
    expect(labels).toEqual(expected);
  });

  it('declares a jwtClaims freshness gate when the token is validated as a jwt', async () => {
    const configs = await loadWarmPopulation();
    const jwtValidated = configs.filter(([, config]) => isJwtValidated(config));
    const missing = jwtValidated.filter(([, config]) => config.jwtClaims === undefined);
    const missingLabels = missing.map(([label]) => label);
    expect(missingLabels).toEqual([]);
  });

  it('reads the stored token from the documented otpLongTermToken field', async () => {
    const configs = await loadWarmPopulation();
    for (const [, config] of configs) {
      expect(config.warmStart?.credsField).toBe('otpLongTermToken');
    }
  });

  it('resumes within the step list rather than past the end of it', async () => {
    const configs = await loadWarmPopulation();
    for (const [, config] of configs) {
      const index = config.warmStart?.fromStepIndex ?? -1;
      expect(index).toBeGreaterThan(0);
      expect(index).toBeLessThanOrEqual(config.steps.length);
    }
  });

  it('resumes past every OTP pre-hook, so a warm start can never send a message', async () => {
    const configs = await loadWarmPopulation();
    for (const [, config] of configs) {
      const lastOtpStep = lastOtpPreHookIndex(config);
      const index = config.warmStart?.fromStepIndex ?? -1;
      expect(index).toBeGreaterThan(lastOtpStep);
    }
  });

  it('ends the warm path holding a usable access token when a header is sent', async () => {
    const configs = await loadWarmPopulation();
    const headerSent = configs.filter(([, config]) => isHeaderSent(config));
    for (const [, config] of headerSent) {
      const resumed = config.steps.slice(config.warmStart?.fromStepIndex ?? 0);
      const produced = resumed.flatMap(step => Object.keys(step.extractsToCarry));
      const carryField = warmCarryField(config);
      expect([...produced, carryField]).toContain('token');
    }
  });

  it('persists a carry token that some login step actually produces', async () => {
    const configs = await loadWarmPopulation();
    const carrySeeded = configs.filter(([, config]) => isCarryToken(config));
    for (const [, config] of carrySeeded) {
      const carryField = warmCarryField(config);
      const produced = config.steps.flatMap(step => Object.keys(step.extractsToCarry));
      expect(produced).toContain(carryField);
    }
  });
});

describe('warm-start contract — policy exemptions', () => {
  it('lists the warm-start banks whose token the bank itself validates', async () => {
    const configs = await loadWarmStartConfigs();
    const exempt = configs.filter(([, config]) => !isJwtValidated(config));
    const exemptLabels = exempt.map(([label]) => label);
    // VisaCal stores an opaque login hash, the ring issuers a device key and
    // Yahav a device bundle, not a JWT; for each, the resume call is the check.
    expect(exemptLabels).toEqual(['VisaCal', 'Isracard', 'Amex', 'Hapoalim', 'Yahav']);
  });

  it('lists the warm-start banks whose session rides on cookies, not a header', async () => {
    const configs = await loadWarmStartConfigs();
    const exempt = configs.filter(([, config]) => !isHeaderSent(config));
    const exemptLabels = exempt.map(([label]) => label);
    expect(exemptLabels).toEqual(['Isracard', 'Amex', 'Hapoalim']);
  });

  it('lists the warm-start banks whose token is the session jar, not a carry slot', async () => {
    const configs = await loadWarmStartConfigs();
    const jarBanks = configs.filter(([, config]) => isJarToken(config));
    const jarLabels = jarBanks.map(([label]) => label);
    // Hapoalim stores its cookie session; the landing call is the check.
    expect(jarLabels).toEqual(['Hapoalim']);
  });

  it('lists the warm-start banks whose token is a bundle of carry slots', async () => {
    const configs = await loadWarmStartConfigs();
    const bundleBanks = configs.filter(([, config]) => isBundleToken(config));
    const bundleLabels = bundleBanks.map(([label]) => label);
    // Yahav stores its device certificate and client; the token call checks it.
    expect(bundleLabels).toEqual(['Yahav']);
  });

  it('the fixture is exempt from both policy-dependent invariants', () => {
    const steps = COOKIE_SESSION_FIXTURE.steps.slice(1);
    const produced = steps.flatMap(step => Object.keys(step.extractsToCarry));
    const isJwt = isJwtValidated(COOKIE_SESSION_FIXTURE);
    const isHeader = isHeaderSent(COOKIE_SESSION_FIXTURE);
    expect(isJwt).toBe(false);
    expect(COOKIE_SESSION_FIXTURE.jwtClaims).toBeUndefined();
    expect(isHeader).toBe(false);
    expect(produced).not.toContain('token');
  });
});

describe('persistent-auth contract — every opted-in bank', () => {
  it('opts in only the banks this suite expects', async () => {
    const configs = await loadPersistentAuthConfigs();
    const labels = configs.map(([label]) => label);
    expect(labels).toEqual(['Pepper']);
  });

  it('renews without any pre-hook, so a durable resume can never send a message', async () => {
    const configs = await loadPersistentAuthConfigs();
    for (const [, , block] of configs) {
      const { resumeSteps } = block;
      const hooked = resumeSteps.filter(step => step.preHook !== undefined);
      expect(resumeSteps.length).toBeGreaterThan(0);
      expect(hooked).toEqual([]);
    }
  });

  it('always ends the renewal holding the warm-start token slot', async () => {
    const configs = await loadPersistentAuthConfigs();
    for (const [, config, block] of configs) {
      const { resumeSteps } = block;
      const produced = resumeSteps.flatMap(step => Object.keys(step.extractsToCarry));
      const carryField = warmCarryField(config);
      expect(produced).toContain(carryField);
    }
  });

  it('seeds the client instance id at flow init, so enrollment and renewal agree', async () => {
    const configs = await loadPersistentAuthConfigs();
    for (const [, config, block] of configs) {
      const seeded = (config.seedCarryFromCreds ?? []).map(entry =>
        typeof entry === 'string' ? entry : entry.field,
      );
      expect(seeded).toContain(block.clientInstanceIdField);
    }
  });
});

/** A bank label, its config and its device-memory block. */
type DeviceMemoryEntry = readonly [string, IApiDirectCallConfig, IDeviceMemoryAuthConfig];

/**
 * Keep a bank only when its persistent-auth block is device-memory.
 * @param label - Bank label.
 * @param config - Bank call config.
 * @returns The entry, or none.
 */
function deviceMemoryEntryOf(label: string, config: IApiDirectCallConfig): DeviceMemoryEntry[] {
  const block = config.persistentAuth;
  if (block?.kind !== 'device-memory') return [];
  return [[label, config, block]];
}

/**
 * Collect every bank whose config declares a device-memory persistentAuth block.
 * @returns Label/config/block entries for device-memory banks.
 */
async function loadDeviceMemoryConfigs(): Promise<readonly DeviceMemoryEntry[]> {
  const pending = CONFIG_PATHS.map(async ([label, path]) => {
    const config = await loadConfig(path);
    return [label, config] as const;
  });
  const loaded = await Promise.all(pending);
  return loaded.flatMap(([label, config]) => deviceMemoryEntryOf(label, config));
}

/**
 * Whether an OTP step is skipped when the bank already knows the device: it
 * runs only on named cases of an earlier step's classifier, and that
 * classifier has a case it does not name that ends the login cleanly.
 * @param config - Bank call config.
 * @param step - A step that asks for a code.
 * @returns True when a remembered device can pass without a code.
 */
function isSkippableOtp(config: IApiDirectCallConfig, step: IStepConfig): boolean {
  const runIf = step.runIf;
  if (runIf === undefined) return false;
  const classifiers = config.steps.flatMap(candidate => candidate.classify ?? []);
  const source = classifiers.find(classifier => classifier.into === runIf.carry);
  const unlisted = (source?.cases ?? []).filter(answer => !runIf.oneOf.includes(answer.name));
  return unlisted.some(answer => answer.fail === undefined);
}

describe('device-memory contract — every opted-in bank', () => {
  it('opts in only the banks this suite expects', async () => {
    const configs = await loadDeviceMemoryConfigs();
    const labels = configs.map(([label]) => label);
    expect(labels).toEqual(['Beinleumi', 'Massad']);
  });

  it('declares no warm start: the remembered device is the only stored state', async () => {
    const configs = await loadDeviceMemoryConfigs();
    const warm = configs.filter(([, config]) => config.warmStart !== undefined);
    expect(warm).toEqual([]);
  });

  it('writes the device id only from answers that keep a remembered one', async () => {
    const configs = await loadDeviceMemoryConfigs();
    for (const [, config, block] of configs) {
      const writes = writesOf(config, block.deviceIdField);
      const overwriting = writes.filter(write => !write.isKeepExisting);
      expect(writes.length).toBeGreaterThan(0);
      expect(overwriting).toEqual([]);
    }
  });

  it('binds the device to a required credential', async () => {
    const configs = await loadDeviceMemoryConfigs();
    for (const [, config, block] of configs) {
      const required = Object.keys(config.requiredCreds ?? {});
      expect(required).toContain(block.accountField);
    }
  });

  it('asks for a code only when the bank does not know the device', async () => {
    const configs = await loadDeviceMemoryConfigs();
    for (const [, config] of configs) {
      const hooked = config.steps.filter(step => step.preHook !== undefined);
      const unskippable = hooked.filter(step => !isSkippableOtp(config, step));
      expect(hooked.length).toBeGreaterThan(0);
      expect(unskippable).toEqual([]);
    }
  });
});
