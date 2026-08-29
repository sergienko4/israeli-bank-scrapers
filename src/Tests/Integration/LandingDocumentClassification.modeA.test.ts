/**
 * T-LANDDOC — does the INIT error-document probe fire only on error
 * documents?
 *
 * <p>The probe runs on the INIT success path of every bank, so a false
 * positive would fail a healthy run. Its selector is a structural CSS
 * match evaluated by Playwright, and no unit test can prove what that
 * engine does to real bank markup. This spec answers both halves with
 * the real engine: it must fire on the document that motivated the
 * probe, and stay silent across every captured bank page in the repo.
 *
 * <p>The positive fixture is the live-captured Discount error document —
 * served under HTTP 200, which is exactly why the status-based landing
 * gate cannot see it. Only its per-response reference number was
 * replaced; the markup is untouched.
 *
 * <p>No credentials, no network — INIT runs before any secret is needed.
 */

import type { Dirent } from 'node:fs';
import { readdirSync } from 'node:fs';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';

import type { Browser, Page } from 'playwright-core';

import { isErrorDocument } from '../../Scrapers/Pipeline/Mediator/Init/LandingDocument.js';
import { newFixturePage } from './Helpers/FixturePage.js';
import {
  closeIntegrationBrowser,
  getIntegrationBrowser,
} from './Helpers/IntegrationBrowserFixture.js';

const BROWSER_BOOT_TIMEOUT_MS = 120_000;
const CASE_TIMEOUT_MS = 300_000;
const SET_CONTENT_TIMEOUT_MS = 15_000;

/** Live-captured Discount error document, served under HTTP 200. */
const SOFT_404_FIXTURE = path.join(
  'src',
  'Tests',
  'Integration',
  'fixtures',
  'init',
  'discount-soft-404.html',
);

/** Root holding every bank's captured page fixtures. */
const BANKS_FIXTURE_ROOT = path.join('src', 'Tests', 'Integration', 'fixtures', 'banks');

/**
 * Every bank with captured fixtures, discovered rather than listed.
 *
 * <p>Read synchronously because `it.each` needs the cases at collection
 * time. Discovery is the point: a hard-coded list silently drops any
 * bank added later, which is exactly when a blast-radius guard is worth
 * having.
 */
const BANK_IDS: readonly string[] = readdirSync(BANKS_FIXTURE_ROOT, { withFileTypes: true })
  .filter((entry): boolean => entry.isDirectory())
  .map((entry): string => entry.name)
  .sort();

/**
 * Floors proving discovery actually walked the corpus, not an empty dir.
 *
 * The corpus measures 13 banks / 298 files today. The regression this
 * guards is a top-level-only walk, which yields 82 — so the floor sits
 * far above that while leaving room for fixtures to come and go.
 */
const MIN_BANKS = 13;
const MIN_FIXTURES = 250;

/**
 * Fold one directory entry into the running list of HTML files.
 * @param dir - Directory holding the entry.
 * @param entry - Entry to fold.
 * @param found - Files discovered so far.
 * @returns Files discovered including this entry's contribution.
 */
async function collectHtml(dir: string, entry: Dirent, found: string[]): Promise<string[]> {
  const full = path.join(dir, entry.name);
  if (!entry.isDirectory()) return entry.name.endsWith('.html') ? [...found, full] : found;
  const nested = await findHtmlFiles(full);
  return [...found, ...nested];
}

/**
 * List every captured HTML file under a directory, at any depth.
 *
 * <p>Recursive on purpose. Most captures live one level down as
 * `main.html` and `frame-*.html`, so a top-level listing would see a
 * fraction of the corpus and the guard below would prove far less than
 * it appears to.
 *
 * @param dir - Directory to walk.
 * @returns Absolute-from-repo-root paths of every `.html` beneath it.
 */
async function findHtmlFiles(dir: string): Promise<readonly string[]> {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  const seed: Promise<string[]> = Promise.resolve([]);
  return entries.reduce(async (prev, entry): Promise<string[]> => {
    const found = await prev;
    return collectHtml(dir, entry, found);
  }, seed);
}

/**
 * List the captured fixtures of one bank.
 * @param bankId - Bank fixture id.
 * @returns Fixture paths for that bank.
 */
async function findHtmlFilesFor(bankId: string): Promise<readonly string[]> {
  const bankRoot = path.join(BANKS_FIXTURE_ROOT, bankId);
  return findHtmlFiles(bankRoot);
}

/**
 * Replay markup into a fresh offline page and ask the production probe.
 * @param browser - Shared Camoufox browser.
 * @param html - Markup to replay.
 * @returns The probe's verdict for that markup.
 */
async function classify(browser: Browser, html: string): Promise<boolean> {
  const page: Page = await newFixturePage(browser);
  try {
    await page.setContent(html, { timeout: SET_CONTENT_TIMEOUT_MS, waitUntil: 'domcontentloaded' });
    return await isErrorDocument(page);
  } finally {
    await page.context().close();
  }
}

/**
 * Classify one captured fixture file.
 *
 * <p>Split out so {@link flaggedFilesFor} stays inside the §19.10 line
 * cap, and so the awaited unit — read markup, run the probe — is named.
 *
 * @param browser - Shared integration browser.
 * @param file - Fixture path to classify.
 * @returns True when the probe flags this file as an error document.
 */
async function classifyFile(browser: Browser, file: string): Promise<boolean> {
  const html = await fs.readFile(file, 'utf8');
  return classify(browser, html);
}

/**
 * Classify every captured fixture of one bank.
 *
 * <p>Sequential by construction: each file opens its own browser
 * context, and replaying the whole corpus concurrently would open
 * hundreds at once. The `reduce` chain is the repo's established way to
 * keep that ordering without awaiting inside a loop.
 *
 * @param bankId - Bank fixture id.
 * @returns Fixture paths the probe flagged as error documents.
 */
async function flaggedFilesFor(bankId: string): Promise<readonly string[]> {
  const browser = await getIntegrationBrowser();
  const files = await findHtmlFilesFor(bankId);
  const seed: Promise<string[]> = Promise.resolve([]);
  return files.reduce(async (prev, file): Promise<string[]> => {
    const flagged = await prev;
    const isError = await classifyFile(browser, file);
    return isError ? [...flagged, file] : flagged;
  }, seed);
}

describe('INIT error-document probe vs real markup (T-LANDDOC)', () => {
  beforeAll(async () => {
    await getIntegrationBrowser();
  }, BROWSER_BOOT_TIMEOUT_MS);

  afterAll(async () => {
    await closeIntegrationBrowser();
  }, BROWSER_BOOT_TIMEOUT_MS);

  // The silence guard below is only worth as much as the corpus it
  // walks. Assert the floor so a discovery regression fails loudly
  // instead of quietly passing over an empty list.
  it('walks the whole captured corpus', async () => {
    const pending = BANK_IDS.map(findHtmlFilesFor);
    const perBank = await Promise.all(pending);
    const total = perBank.reduce((sum, files): number => sum + files.length, 0);
    expect(BANK_IDS.length).toBeGreaterThanOrEqual(MIN_BANKS);
    expect(total).toBeGreaterThanOrEqual(MIN_FIXTURES);
  });

  // The failure the probe exists for: Discount's edge answered a request
  // with its own branded 404 under HTTP 200, so INIT passed the dead
  // page and HOME failed three phases later with "no login nav link".
  it(
    'fires on the captured Discount error document served under HTTP 200',
    async () => {
      const browser = await getIntegrationBrowser();
      const html = await fs.readFile(SOFT_404_FIXTURE, 'utf8');
      const isError = await classify(browser, html);
      expect(isError).toBe(true);
    },
    CASE_TIMEOUT_MS,
  );

  // The blast-radius guard. Every captured page of every bank must read
  // as healthy, or the probe would fail runs that work today.
  it.each(BANK_IDS)(
    'stays silent across every captured %s page',
    async bankId => {
      const flagged = await flaggedFilesFor(bankId);
      expect(flagged).toEqual([]);
    },
    CASE_TIMEOUT_MS,
  );
});
