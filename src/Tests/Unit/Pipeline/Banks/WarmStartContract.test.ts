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

import type { IApiDirectCallConfig } from '../../../../Scrapers/Pipeline/Mediator/ApiDirectCall/ConfigContracts/index.js';

/** Bank label paired with the module path of its call-config literal. */
const CONFIG_PATHS: readonly (readonly [string, string])[] = [
  ['OneZero', '../../../../Scrapers/Pipeline/Registry/Config/PipelineBankConfigOneZero.js'],
  ['Pepper', '../../../../Scrapers/Pipeline/Registry/Config/PipelineBankConfigPepper.js'],
  ['PayBox', '../../../../Scrapers/Pipeline/Registry/Config/PipelineBankConfigPayBox.js'],
];

/** Directory holding every bank call-config literal. */
const CONFIG_DIR = fileURLToPath(
  new URL('../../../../Scrapers/Pipeline/Registry/Config/', import.meta.url),
);

/**
 * Config files this suite knows about. Derived drift against the directory is
 * a failure: a warm-start bank that never reaches {@link CONFIG_PATHS} would
 * otherwise be invisible to every invariant below.
 */
const EXPECTED_WARM_START_FILES: readonly string[] = [
  'PipelineBankConfigOneZero.ts',
  'PipelineBankConfigPayBox.ts',
  'PipelineBankConfigPepper.ts',
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

describe('warm-start contract — every opted-in bank', () => {
  it('covers exactly the warm-start banks present on disk', async () => {
    const files = await findWarmStartConfigFiles();
    expect(files).toEqual([...EXPECTED_WARM_START_FILES]);
  });

  it('loads every bank this suite enumerates', async () => {
    const configs = await loadWarmStartConfigs();
    const labels = configs.map(([label]) => label);
    expect(labels).toEqual(['OneZero', 'Pepper', 'PayBox']);
  });

  it('declares a jwtClaims freshness gate, so staleness is caught client-side', async () => {
    const configs = await loadWarmStartConfigs();
    const missing = configs.filter(([, config]) => config.jwtClaims === undefined);
    const missingLabels = missing.map(([label]) => label);
    expect(missingLabels).toEqual([]);
  });

  it('reads the stored token from the documented otpLongTermToken field', async () => {
    const configs = await loadWarmStartConfigs();
    for (const [, config] of configs) {
      expect(config.warmStart?.credsField).toBe('otpLongTermToken');
    }
  });

  it('resumes within the step list rather than past the end of it', async () => {
    const configs = await loadWarmStartConfigs();
    for (const [, config] of configs) {
      const index = config.warmStart?.fromStepIndex ?? -1;
      expect(index).toBeGreaterThan(0);
      expect(index).toBeLessThanOrEqual(config.steps.length);
    }
  });

  it('always ends the warm path holding a usable access token', async () => {
    const configs = await loadWarmStartConfigs();
    for (const [, config] of configs) {
      const resumed = config.steps.slice(config.warmStart?.fromStepIndex ?? 0);
      const produced = resumed.flatMap(step => Object.keys(step.extractsToCarry));
      expect([...produced, config.warmStart?.carryField]).toContain('token');
    }
  });

  it('persists a token that some login step actually produces', async () => {
    const configs = await loadWarmStartConfigs();
    for (const [, config] of configs) {
      const carryField = config.warmStart?.carryField ?? '';
      const produced = config.steps.flatMap(step => Object.keys(step.extractsToCarry));
      expect(produced).toContain(carryField);
    }
  });
});
