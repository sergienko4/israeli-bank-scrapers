/**
 * Warns when the installed browser stack differs from the pair this package
 * is tested on: the Camoufox tag and playwright-core minor in
 * `browser-stack.json`, read from the module generated from it.
 *
 * camoufox-js downloads, on first launch, the newest stable Camoufox release
 * it supports that has a build for the platform, and reuses that cache while
 * it still supports its version, so a consumer can run an older or newer
 * build than the tested one. A mismatch may still
 * work, so it never fails a launch; it is logged once per process so the
 * cause is on record if a scrape then breaks.
 */

import { existsSync, readFileSync, realpathSync } from 'node:fs';
import { createRequire } from 'node:module';
import * as path from 'node:path';

import ScraperError from '../../../Base/ScraperError.js';
import { getDebug } from '../../Logging/Debug.js';
import type { Brand } from '../../Types/Brand.js';
import { redactErrorMessage } from '../../Types/PiiRedactor.js';
import { TESTED_CAMOUFOX_TAG, TESTED_PLAYWRIGHT_MINOR } from './BrowserStackConfig.js';

const LOG = getDebug(import.meta.url);

/** Number of warnings one check emitted: 0, 1 or 2. */
export type WarningCount = Brand<number, 'WarningCount'>;

/** A check that resolves to the number of warnings it logged. */
export type BrowserStackCheck = () => Promise<WarningCount>;

/** Reads one installed version; may reject. */
type VersionReader = () => Promise<string>;

/** The one `package.json` field the playwright-core reader needs. */
interface IPackageManifest {
  readonly version: string;
}

/** Installed-version readers; tests inject their own. */
export interface IStackReaders {
  readonly camoufox: VersionReader;
  readonly playwright: VersionReader;
}

/** How one component's installed version is compared and reported. */
interface IComponentRule {
  readonly component: 'camoufox' | 'playwright-core';
  readonly tested: string;
  readonly comparable: (installed: string) => string;
  readonly remedy: string;
}

/** The package that imports playwright-core and launches the browser. */
const CAMOUFOX_PACKAGE = '@hieutran094/camoufox-js';

/** The package whose version the playwright reader reports. */
const PLAYWRIGHT_PACKAGE = 'playwright-core';

/** Every reader, in report order. */
const COMPONENT_KEYS = Object.freeze(['camoufox', 'playwright'] as const);

/** One reader key. */
type ComponentKey = (typeof COMPONENT_KEYS)[number];

/**
 * Installed version in the camoufox-js record's own form.
 *
 * @param installed - `<version>-<release>` from camoufox-js.
 * @returns The same string.
 */
function camoufoxComparable(installed: string): string {
  return installed;
}

/**
 * `major.minor` of a playwright-core version.
 *
 * @param installed - Full semver, such as `1.63.0`.
 * @returns Its minor, such as `1.63`.
 */
function playwrightComparable(installed: string): string {
  const parts = installed.split('.');
  return parts.slice(0, 2).join('.');
}

/**
 * Per reader: the tested value and how an installed value is compared to it.
 * camoufox-js records `<version>-<release>`, the tag without its `v`; a
 * playwright-core patch release still counts as the tested minor.
 */
const RULES: Readonly<Record<ComponentKey, IComponentRule>> = Object.freeze({
  camoufox: {
    component: 'camoufox',
    tested: TESTED_CAMOUFOX_TAG.slice(1),
    comparable: camoufoxComparable,
    remedy: 'Clear the Camoufox cache to refetch, or upgrade @sergienko4/israeli-bank-scrapers',
  },
  playwright: {
    component: 'playwright-core',
    tested: TESTED_PLAYWRIGHT_MINOR,
    comparable: playwrightComparable,
    remedy: 'Install a playwright-core version matching the tested minor',
  },
});

/**
 * Version of the Camoufox build camoufox-js has cached.
 *
 * @returns `<version>-<release>`; rejects when nothing is installed.
 */
async function readCamoufox(): Promise<string> {
  const pkgman = await import('@hieutran094/camoufox-js/dist/pkgman.js');
  return pkgman.installedVerStr();
}

/**
 * The real path of the manifest of the `packageName` copy Node loads from
 * `from`. The package directory is looked up along Node's own search paths
 * rather than resolved, since an `exports` map without `./package.json`
 * would make resolving the manifest fail. The real path keeps symlinked
 * layouts, such as pnpm's, resolving from where the package really lives.
 *
 * @param from - Module path or file URL the lookup starts from.
 * @param packageName - Package to find.
 * @returns Its `package.json` path; throws when no search path has it.
 */
function findManifest(from: string, packageName: string): string {
  const searchDirs = createRequire(from).resolve.paths(packageName) ?? [];
  const manifests = searchDirs.map((dir): string => path.join(dir, packageName, 'package.json'));
  const found = manifests.find((manifest): boolean => existsSync(manifest));
  if (found === undefined) throw new ScraperError(`${packageName} is not installed`);
  return realpathSync(found);
}

/**
 * Version of the playwright-core that drives the browser. camoufox-js takes
 * playwright-core as a peer and imports it from its own location, and the
 * dependency tree can hold more than one copy, so the read finds
 * camoufox-js first and playwright-core from there. Read as a file, not a
 * JSON import: the build's Rollup tree-shake pass rewrites import attributes
 * to the `assert` keyword, which Node 22 rejects, so that read would fail in
 * the published package alone.
 *
 * @param anchor - Module path or file URL to find camoufox-js from.
 * @returns Its `package.json` version.
 */
function readPlaywrightManifest(anchor: string): string {
  const camoufoxManifest = findManifest(anchor, CAMOUFOX_PACKAGE);
  const playwrightManifest = findManifest(camoufoxManifest, PLAYWRIGHT_PACKAGE);
  const text = readFileSync(playwrightManifest, 'utf8');
  const manifest = JSON.parse(text) as IPackageManifest;
  return manifest.version;
}

/**
 * Version of the playwright-core camoufox-js loads when found from `anchor`,
 * with any throw turned into a rejection.
 *
 * @param anchor - Module path or file URL to find camoufox-js from.
 * @returns Its `package.json` version.
 */
export function readPlaywrightVersion(anchor: string): Promise<string> {
  const settled = Promise.resolve(anchor);
  return settled.then(readPlaywrightManifest);
}

/**
 * Version of the playwright-core the camoufox-js this package loads uses.
 *
 * @returns Its `package.json` version.
 */
function readPlaywright(): Promise<string> {
  return readPlaywrightVersion(import.meta.url);
}

/**
 * Production readers. Neither uses import attributes, so the ESM and CJS
 * builds read them the same way.
 */
export const DEFAULT_STACK_READERS: IStackReaders = Object.freeze({
  camoufox: readCamoufox,
  playwright: readPlaywright,
});

/**
 * Read one installed version. A failure is logged at debug level with the
 * message redacted to its length, and skips the component.
 *
 * @param key - Reader to call.
 * @param readers - Reader set.
 * @returns The installed version, or false when it could not be read.
 */
async function readInstalled(key: ComponentKey, readers: IStackReaders): Promise<string | false> {
  try {
    return await readers[key]();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    LOG.debug({ component: RULES[key].component, error: redactErrorMessage(message) });
    return false;
  }
}

/**
 * Compare one component with its tested value; warn when they differ.
 *
 * @param key - Reader to check.
 * @param readers - Reader set.
 * @returns 1 when a warning was logged, else 0.
 */
async function checkComponent(key: ComponentKey, readers: IStackReaders): Promise<number> {
  const installed = await readInstalled(key, readers);
  const { component, tested, comparable, remedy } = RULES[key];
  if (installed === false || comparable(installed) === tested) return 0;
  LOG.warn({ component, installed, tested, remedy }, 'browser stack differs from the tested pair');
  return 1;
}

/**
 * Check one component, counting any failure, the logger's own included, as
 * no warning. Nothing is logged here, since a throwing logger is one of the
 * failures this absorbs.
 *
 * @param key - Reader to check.
 * @param readers - Reader set.
 * @returns 1 when a warning was logged, else 0.
 */
function settleComponent(key: ComponentKey, readers: IStackReaders): Promise<number> {
  const checking = checkComponent(key, readers);
  return checking.catch((): number => 0);
}

/** Run state of one check. */
interface ICheckState {
  hasRun: boolean;
}

/**
 * Check every component on the first call only.
 *
 * @param state - Run state shared by the calls of one check.
 * @param readers - Reader set.
 * @returns The number of warnings logged; 0 on any later call.
 */
async function runOnce(state: ICheckState, readers: IStackReaders): Promise<WarningCount> {
  if (state.hasRun) return 0 as WarningCount;
  state.hasRun = true;
  const pending = COMPONENT_KEYS.map(key => settleComponent(key, readers));
  const counts = await Promise.all(pending);
  return counts.reduce((sum, count) => sum + count, 0) as WarningCount;
}

/**
 * Build a check that reads and compares only on its first call; later calls
 * return 0 at once. Never rejects: a reader or logger failure only skips
 * that component.
 *
 * @param readers - Version readers; production uses {@link DEFAULT_STACK_READERS}.
 * @returns The check.
 */
export function createBrowserStackCheck(readers = DEFAULT_STACK_READERS): BrowserStackCheck {
  const state: ICheckState = { hasRun: false };
  return (): Promise<WarningCount> => runOnce(state, readers);
}

/** The process-wide check. */
const PROCESS_CHECK = createBrowserStackCheck();

/**
 * Check the installed stack once per process; the launcher calls it after
 * every successful launch.
 *
 * @returns The number of warnings logged; 0 after the first call.
 */
export function checkBrowserStack(): Promise<WarningCount> {
  return PROCESS_CHECK();
}
