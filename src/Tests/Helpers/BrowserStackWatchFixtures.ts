/**
 * Fixtures shared by the browser-stack watch tests.
 *
 * Camoufox releases with an asset for one platform, camoufox-js's asset check
 * for that platform, the watch's two input files (manifest, package.json)
 * written to a fresh temporary directory, and output I/O that captures what a
 * run prints.
 */

import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import type {
  IPlatformAssetCheck,
  IRelease,
  IReleaseAsset,
} from '../../../scripts/browser-stack/camoufox-releases.mjs';
import type { IWatchIo } from '../../../scripts/browser-stack/watch.mjs';

const HERE = fileURLToPath(import.meta.url);
const HERE_DIR = dirname(HERE);
const ROOT = join(HERE_DIR, '../../..');
const MANIFEST_PATH = join(ROOT, 'browser-stack.json');
const MANIFEST_TEXT = readFileSync(MANIFEST_PATH, 'utf8');

/** The platform every fixture release carries an asset for. */
export const PLATFORM = 'lin.x86_64';

/** `playwrightCore.testedMinor` of every fixture manifest. */
export const TESTED_MINOR = '1.63';

/** The library's playwright-core range, unless a test writes another. */
export const RANGE = '^1.62.0';

/** The clock of every run. */
const CHECKED_AT = '2026-05-04T06:00:00Z';

/** Temporary directories to remove after the tests. */
const DIRS: string[] = [];

/** The texts of the watch's two input files. */
export interface IInputTexts {
  readonly manifestTag: string;
  readonly packageJson: string;
}

/** Where the watch's two input files were written. */
export interface IInputPaths {
  readonly manifestPath: string;
  readonly packagePath: string;
}

/** What one run printed and wrote. */
export interface IPrinted {
  out: string;
  err: string;
  readonly written: Record<string, string>;
}

/** The output members of the watch I/O. */
export type PrintingIo = Required<Pick<IWatchIo, 'now' | 'writeFile' | 'stdout' | 'stderr'>>;

/**
 * One release; stable ones carry an asset for {@link PLATFORM}.
 *
 * @param tag - Release tag.
 * @param prerelease - Whether it is a prerelease.
 * @returns The release.
 */
export function release(tag: string, prerelease = false): IRelease {
  const name = `camoufox-${tag.slice(1)}-${PLATFORM}.zip`;
  const assets: IReleaseAsset[] = [{ name, browser_download_url: `https://x/${name}` }];
  return { tag_name: tag, prerelease, draft: false, assets };
}

/** A camoufox-js asset check for {@link PLATFORM}. */
export const ASSET_CHECK: IPlatformAssetCheck = {
  platform: 'lin x86_64',
  /**
   * Accept assets built for {@link PLATFORM}.
   *
   * @param asset - Release asset.
   * @returns Whether camoufox-js would install it.
   */
  acceptsAsset: (asset: IReleaseAsset): boolean => asset.name.endsWith(`-${PLATFORM}.zip`),
};

/**
 * A package.json declaring `range` for playwright-core.
 *
 * @param range - The dependency range.
 * @returns package.json JSON.
 */
export function packageWith(range: string): string {
  return JSON.stringify({ dependencies: { 'playwright-core': range } });
}

/**
 * The real manifest with another Camoufox tag and {@link TESTED_MINOR}.
 *
 * @param tag - Camoufox tag.
 * @returns Manifest JSON.
 */
function manifestWith(tag: string): string {
  const manifest = JSON.parse(MANIFEST_TEXT) as {
    camoufox: { tag: string };
    playwrightCore: { testedMinor: string };
  };
  manifest.camoufox.tag = tag;
  manifest.playwrightCore.testedMinor = TESTED_MINOR;
  return JSON.stringify(manifest);
}

/**
 * A fresh temporary directory, removed by {@link removeInputs}.
 *
 * @returns Its path.
 */
function freshDir(): string {
  const temp = tmpdir();
  const prefix = join(temp, 'bs-watch-');
  const dir = mkdtempSync(prefix);
  DIRS.push(dir);
  return dir;
}

/**
 * Write the watch's two input files to a fresh temporary directory.
 *
 * @param texts - Manifest tag and package.json texts.
 * @returns The two paths.
 */
export function writeInputs(texts: IInputTexts): IInputPaths {
  const dir = freshDir();
  const paths: IInputPaths = {
    manifestPath: join(dir, 'browser-stack.json'),
    packagePath: join(dir, 'package.json'),
  };
  const manifestText = manifestWith(texts.manifestTag);
  writeFileSync(paths.manifestPath, manifestText);
  writeFileSync(paths.packagePath, texts.packageJson);
  return paths;
}

/**
 * Remove every directory {@link writeInputs} made.
 *
 * @returns How many were removed.
 */
export function removeInputs(): number {
  const dirs = DIRS.splice(0);
  for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
  return dirs.length;
}

/**
 * Output I/O of one run that captures into `printed`, on a fixed clock.
 *
 * @param printed - Where the output goes.
 * @returns `now`, `writeFile`, `stdout` and `stderr`.
 */
export function printingIo(printed: IPrinted): PrintingIo {
  return {
    /**
     * A fixed clock.
     *
     * @returns The check date.
     */
    now: (): Date => new Date(CHECKED_AT),
    /**
     * Record a written file.
     *
     * @param path - File path.
     * @param text - File text.
     * @returns Always true.
     */
    writeFile: (path: string, text: string): boolean => {
      printed.written[path] = text;
      return true;
    },
    /**
     * Capture stdout.
     *
     * @param text - Written text.
     * @returns Like `process.stdout.write`.
     */
    stdout: (text: string): boolean => {
      printed.out += text;
      return true;
    },
    /**
     * Capture stderr.
     *
     * @param text - Written text.
     * @returns Like `process.stderr.write`.
     */
    stderr: (text: string): boolean => {
      printed.err += text;
      return true;
    },
  };
}
