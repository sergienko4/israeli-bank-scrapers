/**
 * Architectural canary — the window-narrowing contract cannot drift behind
 * the product.
 *
 * <p>`WindowNarrowing.test.ts` proves each bank's declared stance is *true*,
 * and `windowNarrowing` is a required field, so `tsc` already stops a bank
 * from being added without declaring one. Neither guards the gap between
 * them: that contract's bank list is hand-written and its size asserted as a
 * literal. Bank #17 could be added to the product, declare a stance, and
 * never reach the contract — leaving it unproven while the suite stayed
 * green.
 *
 * <p>This canary derives the bank list from the source tree, so the contract
 * table and the product cannot disagree.
 *
 * <p>The sibling concern — a shape bounding its window from the wall clock
 * rather than `scrapeWindowEnd(ctx)` — is enforced by ESLint §20
 * (SHAPE TRANSACTIONS WINDOW-END LOCK) and its canary fixture, which carry
 * the file scope and the verified per-bank exclusions that rule needs.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

import { WINDOW_NARROWING_CASES } from './WindowNarrowingFixtures.js';

const HERE_FILE = fileURLToPath(import.meta.url);
const HERE_DIR = path.dirname(HERE_FILE);
const BANKS_ROOT = path.join(HERE_DIR, '../../../../../Scrapers/Pipeline/Banks');

/** Marks a file as declaring a bank's window-narrowing stance. */
const STANCE_TOKEN = 'windowNarrowing:';

/**
 * Lower-case the first character so a directory name matches the identifier
 * the contract table uses for the same bank.
 *
 * @param dirName - Bank directory name, e.g. `OneZero`.
 * @returns Contract-table bank name, e.g. `oneZero`.
 */
function bankNameOf(dirName: string): string {
  const head = dirName.slice(0, 1).toLowerCase();
  return `${head}${dirName.slice(1)}`;
}

/**
 * Absolute paths of the `.ts` files in one bank's `scrape/` folder.
 *
 * @param dirName - Bank directory name under `Banks/`.
 * @returns Absolute file paths, empty when the bank has no `scrape/` folder.
 */
function scrapeFilesOf(dirName: string): readonly string[] {
  const dir = path.join(BANKS_ROOT, dirName, 'scrape');
  if (!fs.existsSync(dir)) return [];
  const names = fs.readdirSync(dir).filter((name): boolean => name.endsWith('.ts'));
  return names.map((name): string => path.join(dir, name));
}

/**
 * Every bank directory name under `Banks/`.
 *
 * @returns Directory names, one per bank.
 */
function bankDirs(): readonly string[] {
  const entries = fs.readdirSync(BANKS_ROOT, { withFileTypes: true });
  return entries.filter((entry): boolean => entry.isDirectory()).map((entry): string => entry.name);
}

/**
 * Whether any file in this bank's `scrape/` folder declares a stance.
 *
 * @param dirName - Bank directory name under `Banks/`.
 * @returns True when the bank participates in the API-direct scrape phase.
 */
function didDeclareStance(dirName: string): boolean {
  const files = scrapeFilesOf(dirName);
  return files.some((file): boolean => fs.readFileSync(file, 'utf8').includes(STANCE_TOKEN));
}

/**
 * Contract-table names of every bank declaring a stance on disk.
 *
 * @returns Bank names, sorted so the comparison is order-insensitive.
 */
function declaredBanks(): readonly string[] {
  const declaring = bankDirs().filter(didDeclareStance);
  return declaring.map(bankNameOf).sort();
}

describe('WINDOW-CANARY — every bank that declares a stance is proven', () => {
  it('covers exactly the banks that declare one in the source tree', () => {
    const onDisk = declaredBanks();
    const inContract = WINDOW_NARROWING_CASES.map((testCase): string => testCase.bank).sort();
    expect(inContract).toEqual(onDisk);
  });
});
