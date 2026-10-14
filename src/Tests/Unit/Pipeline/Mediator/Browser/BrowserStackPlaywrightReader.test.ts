/**
 * Unit tests for which playwright-core copy the browser-stack check reads.
 *
 * <p>camoufox-js takes playwright-core as a peer and imports it from its own
 * location, and the dependency tree can hold more than one copy; the one
 * camoufox-js loads drives the browser. These tests lay out such trees on
 * disk and check that the reader follows camoufox-js, not the copy beside
 * the anchor.
 */

import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

const { readPlaywrightVersion: READ_PLAYWRIGHT_VERSION } =
  await import('../../../../../Scrapers/Pipeline/Mediator/Browser/BrowserStackCheck.js');

/** camoufox-js's directory inside a fake tree. */
const CAMOUFOX_DIR = 'node_modules/@hieutran094/camoufox-js';
/** This package's directory inside a fake npm tree. */
const SCRAPER_DIR = 'node_modules/@sergienko4/israeli-bank-scrapers';
/** pnpm's real home of camoufox-js and its peers inside a fake tree. */
const PNPM_DIR = 'node_modules/.pnpm/camoufox-js/node_modules';
/** The playwright-core copy hoisted beside the anchor. */
const HOISTED_VERSION = '1.11.0';
/** The playwright-core copy nested under camoufox-js. */
const NESTED_VERSION = '1.22.0';
/** Temp roots to remove after the suite. */
const ROOTS: string[] = [];

/**
 * Write a file under `root`, creating its parent directories.
 *
 * @param root - Tree root.
 * @param relative - Path inside the tree.
 * @param text - File contents.
 * @returns The written path.
 */
function writeTreeFile(root: string, relative: string, text: string): string {
  const target = join(root, relative);
  const parent = dirname(target);
  mkdirSync(parent, { recursive: true });
  writeFileSync(target, text);
  return target;
}

/**
 * Write a playwright-core manifest at `directory`.
 *
 * @param root - Tree root.
 * @param directory - Package directory inside the tree.
 * @param version - Version to record.
 * @returns The written path.
 */
function writePlaywright(root: string, directory: string, version: string): string {
  const manifest = JSON.stringify({ name: 'playwright-core', version });
  return writeTreeFile(root, `${directory}/playwright-core/package.json`, manifest);
}

/**
 * Create an empty temp tree, removed after the suite.
 *
 * @returns Its root.
 */
function makeRoot(): string {
  const tempBase = tmpdir();
  const prefix = join(tempBase, 'browser-stack-reader-');
  const root = mkdtempSync(prefix);
  ROOTS.push(root);
  return root;
}

/**
 * Write a camoufox-js manifest at `directory`.
 *
 * @param root - Tree root.
 * @param directory - Package directory inside the tree.
 * @param fields - Extra manifest fields, such as `exports`.
 * @returns The written path.
 */
function writeCamoufox(root: string, directory: string, fields: object = {}): string {
  const base = { name: '@hieutran094/camoufox-js', main: 'dist/index.js' };
  const manifest = JSON.stringify({ ...base, ...fields });
  return writeTreeFile(root, `${directory}/package.json`, manifest);
}

/**
 * Lay out a hoisted playwright-core plus camoufox-js, which gets its own
 * nested copy only when `nested` names a version.
 *
 * @param nested - Version of the nested copy, or false for none.
 * @param fields - Extra camoufox-js manifest fields.
 * @returns The tree root.
 */
function makeTree(nested: string | false, fields: object = {}): string {
  const root = makeRoot();
  writePlaywright(root, 'node_modules', HOISTED_VERSION);
  writeCamoufox(root, CAMOUFOX_DIR, fields);
  if (nested !== false) writePlaywright(root, `${CAMOUFOX_DIR}/node_modules`, nested);
  return root;
}

/**
 * Lay out pnpm's shape: camoufox-js and its own playwright-core copy live
 * side by side in a store directory, and a symlink exposes camoufox-js at
 * the top. A hoisted copy sits beside the anchor as the wrong answer.
 *
 * @returns The tree root.
 */
function makePnpmTree(): string {
  const root = makeRoot();
  writePlaywright(root, 'node_modules', HOISTED_VERSION);
  writePlaywright(root, PNPM_DIR, NESTED_VERSION);
  const storeManifest = writeCamoufox(root, `${PNPM_DIR}/@hieutran094/camoufox-js`);
  const linkPath = join(root, CAMOUFOX_DIR);
  const linkParent = dirname(linkPath);
  mkdirSync(linkParent, { recursive: true });
  const storeDir = dirname(storeManifest);
  symlinkSync(storeDir, linkPath, 'dir');
  return root;
}

/**
 * Path of a module file at `directory` inside the tree.
 *
 * @param root - Tree root.
 * @param directory - Directory inside the tree.
 * @returns The anchor path to resolve from.
 */
function anchorIn(root: string, directory = '.'): string {
  return join(root, directory, 'index.js');
}

describe('readPlaywrightVersion', () => {
  afterAll(() => {
    for (const root of ROOTS) rmSync(root, { recursive: true, force: true });
  });

  it('[BSP-1] reads the copy nested under camoufox-js, not the hoisted one', async () => {
    const root = makeTree(NESTED_VERSION);
    const anchor = anchorIn(root);
    const installed = await READ_PLAYWRIGHT_VERSION(anchor);
    expect(installed).toBe(NESTED_VERSION);
  });

  it('[BSP-2] reads the hoisted copy when camoufox-js shares it', async () => {
    const root = makeTree(false);
    const anchor = anchorIn(root);
    const installed = await READ_PLAYWRIGHT_VERSION(anchor);
    expect(installed).toBe(HOISTED_VERSION);
  });

  it('[BSP-3] rejects, rather than throwing, when camoufox-js cannot be resolved', async () => {
    const root = makeRoot();
    const anchor = anchorIn(root);
    const reading = READ_PLAYWRIGHT_VERSION(anchor);
    await expect(reading).rejects.toThrow(/@hieutran094\/camoufox-js/);
  });

  it('[BSP-4] still finds camoufox-js when its exports map hides package.json', async () => {
    const root = makeTree(NESTED_VERSION, { exports: { '.': './dist/index.js' } });
    const anchor = anchorIn(root);
    const installed = await READ_PLAYWRIGHT_VERSION(anchor);
    expect(installed).toBe(NESTED_VERSION);
  });

  it("[BSP-5] reads camoufox-js's hoisted copy, not this package's nested one", async () => {
    const root = makeTree(false);
    writePlaywright(root, `${SCRAPER_DIR}/node_modules`, NESTED_VERSION);
    const anchor = anchorIn(root, `${SCRAPER_DIR}/lib`);
    const installed = await READ_PLAYWRIGHT_VERSION(anchor);
    expect(installed).toBe(HOISTED_VERSION);
  });

  it('[BSP-6] follows a symlinked camoufox-js to the copy beside its real path', async () => {
    const root = makePnpmTree();
    const anchor = anchorIn(root);
    const installed = await READ_PLAYWRIGHT_VERSION(anchor);
    expect(installed).toBe(NESTED_VERSION);
  });
});
