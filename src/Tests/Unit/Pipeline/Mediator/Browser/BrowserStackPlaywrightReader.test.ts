/**
 * Unit tests for which playwright-core copy the browser-stack check reads.
 *
 * <p>camoufox-js takes playwright-core as a peer and imports it from its own
 * location. When npm cannot hoist one copy for both, camoufox-js gets a
 * nested copy, and that copy drives the browser. These tests lay out such
 * trees on disk and check that the reader follows camoufox-js, not the copy
 * beside the anchor.
 */

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

const { readPlaywrightVersion: READ_PLAYWRIGHT_VERSION } =
  await import('../../../../../Scrapers/Pipeline/Mediator/Browser/BrowserStackCheck.js');

/** camoufox-js's directory inside a fake tree. */
const CAMOUFOX_DIR = 'node_modules/@hieutran094/camoufox-js';
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
 * Lay out a hoisted playwright-core plus camoufox-js, which gets its own
 * nested copy only when `nested` names a version.
 *
 * @param nested - Version of the nested copy, or false for none.
 * @returns The anchor path to resolve from.
 */
function makeTree(nested: string | false): string {
  const root = makeRoot();
  writePlaywright(root, 'node_modules', HOISTED_VERSION);
  const camoufoxManifest = JSON.stringify({
    name: '@hieutran094/camoufox-js',
    main: 'dist/index.js',
  });
  writeTreeFile(root, `${CAMOUFOX_DIR}/package.json`, camoufoxManifest);
  if (nested !== false) writePlaywright(root, `${CAMOUFOX_DIR}/node_modules`, nested);
  return join(root, 'index.js');
}

describe('readPlaywrightVersion', () => {
  afterAll(() => {
    for (const root of ROOTS) rmSync(root, { recursive: true, force: true });
  });

  it('[BSP-1] reads the copy nested under camoufox-js, not the hoisted one', async () => {
    const anchor = makeTree(NESTED_VERSION);
    const installed = await READ_PLAYWRIGHT_VERSION(anchor);
    expect(installed).toBe(NESTED_VERSION);
  });

  it('[BSP-2] reads the hoisted copy when camoufox-js shares it', async () => {
    const anchor = makeTree(false);
    const installed = await READ_PLAYWRIGHT_VERSION(anchor);
    expect(installed).toBe(HOISTED_VERSION);
  });

  it('[BSP-3] rejects, rather than throwing, when camoufox-js cannot be resolved', async () => {
    const root = makeRoot();
    const anchor = join(root, 'index.js');
    const reading = READ_PLAYWRIGHT_VERSION(anchor);
    await expect(reading).rejects.toThrow(/@hieutran094\/camoufox-js/);
  });
});
