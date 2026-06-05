/**
 * Integration-test fixture loader.
 *
 * <p>Loads a captured bank PRE-LOGIN HTML snapshot into a real Playwright
 * page so production code (`createElementMediator`, `executeDiscoverFields`,
 * etc.) can operate against the EXACT DOM the live LOGIN PRE phase faces —
 * deterministically, offline, no credentials.
 *
 * <p>External resources (CDN scripts, fonts, images, analytics) are
 * aborted at the network layer so:
 * <ol>
 *   <li>No real bytes are fetched (no analytics beacons, no CDN noise).</li>
 *   <li>Page load completes deterministically without flaky waits.</li>
 * </ol>
 * Only the static DOM tree is used by the integration tests — Angular
 * runtime hydration is out of scope (covered by real-bank E2E).
 */

import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as url from 'node:url';

import type { Browser, Page } from 'playwright-core';

import { buildContextOptions } from '../../../Common/Browser.js';

const FIXTURES_ROOT_REL = 'src/Tests/Integration/fixtures/banks';
const SET_CONTENT_TIMEOUT_MS = 15000;

/** Bank fixture identifiers. */
interface IBankFixturePaths {
  readonly bankId: string;
  readonly fixtureRoot: string;
  readonly steps: readonly string[];
}

/**
 * Resolve the absolute fixture root for a bank.
 * @param bankId - Bank recipe id.
 * @returns Absolute path.
 */
function resolveFixtureRoot(bankId: string): string {
  const here = url.fileURLToPath(new URL('.', import.meta.url));
  const repoRoot = path.resolve(here, '..', '..', '..', '..');
  return path.join(repoRoot, FIXTURES_ROOT_REL, bankId);
}

/**
 * Discover the step names for a bank by listing top-level *.html files.
 * Sorted lexicographically so step order matches recipe order.
 * @param fixtureRoot - Bank fixture root.
 * @returns Step names (without `.html` extension).
 */
async function discoverSteps(fixtureRoot: string): Promise<readonly string[]> {
  const entries = await fs.readdir(fixtureRoot, { withFileTypes: true });
  const htmls = entries.filter((e): boolean => e.isFile() && e.name.endsWith('.html'));
  const names = htmls.map((e): string => e.name.replace(/\.html$/, ''));
  return [...names].sort();
}

/**
 * Build the fixture-paths handle for a bank.
 * @param bankId - Bank recipe id.
 * @returns Fixture paths.
 */
async function loadBankFixturePaths(bankId: string): Promise<IBankFixturePaths> {
  const fixtureRoot = resolveFixtureRoot(bankId);
  const steps = await discoverSteps(fixtureRoot);
  return { bankId, fixtureRoot, steps };
}

/**
 * Read the HTML for one step.
 * @param paths - Fixture-paths handle.
 * @param stepName - Step name (e.g. `03-after-flip`).
 * @returns Step HTML as UTF-8 string.
 */
async function readStepHtml(paths: IBankFixturePaths, stepName: string): Promise<string> {
  const file = path.join(paths.fixtureRoot, `${stepName}.html`);
  return fs.readFile(file, 'utf8');
}

/**
 * Install a request-blocking route on the page so external resources
 * never escape the test process. Internal `about:blank` documents pass
 * through unaffected.
 * @param page - Playwright page.
 */
async function blockExternalResources(page: Page): Promise<void> {
  await page.route('**/*', (route): Promise<void> => route.abort('blockedbyclient'));
}

/**
 * Create a fresh Playwright page wired to abort all network requests.
 * @param browser - Shared Camoufox browser.
 * @returns Ready-to-use page.
 */
async function newFixturePage(browser: Browser): Promise<Page> {
  const opts = buildContextOptions();
  const context = await browser.newContext(opts);
  const page = await context.newPage();
  await blockExternalResources(page);
  await page.goto('about:blank', { waitUntil: 'domcontentloaded' });
  return page;
}

/**
 * Load a captured step's HTML into the page via `setContent`.
 * Uses `domcontentloaded` so we never wait on external resources.
 * @param page - Playwright page (returned by {@link newFixturePage}).
 * @param paths - Fixture-paths handle.
 * @param stepName - Step name to load.
 */
async function loadStep(page: Page, paths: IBankFixturePaths, stepName: string): Promise<void> {
  const html = await readStepHtml(paths, stepName);
  await page.setContent(html, { waitUntil: 'domcontentloaded', timeout: SET_CONTENT_TIMEOUT_MS });
}

export type { IBankFixturePaths };
export { loadBankFixturePaths, loadStep, newFixturePage, readStepHtml, resolveFixtureRoot };
