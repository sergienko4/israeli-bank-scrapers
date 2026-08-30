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

import ScraperError from '../../Scrapers/Base/ScraperError.js';
import { isErrorDocument } from '../../Scrapers/Pipeline/Mediator/Init/LandingDocument.js';
import { newFixturePage } from './Helpers/FixturePage.js';
import type { IReplaySession } from './Helpers/FixtureReplay.js';
import flaggedFixtures from './Helpers/FixtureReplay.js';
import {
  closeIntegrationBrowser,
  getIntegrationBrowser,
} from './Helpers/IntegrationBrowserFixture.js';

const BROWSER_BOOT_TIMEOUT_MS = 120_000;
const CASE_TIMEOUT_MS = 300_000;

/**
 * Deadline for loading one fixture into the page.
 *
 * <p>Sized as a hang detector, not a speed limit. Every request is
 * aborted before it leaves the process, so nothing here can legitimately
 * wait on a network; the only way to reach this deadline is a genuine
 * stall. With the realm reset in place the slowest fixture in the corpus
 * — Leumi's 2.6MB, 114-script account-resolve frame — loads in 631ms
 * locally, so this leaves a ~47x margin.
 *
 * <p>It was previously 15s, which a contended CI runner could exceed on
 * that same fixture. That made the verdict a function of runner load
 * rather than of the markup, which is the one thing a classification
 * spec must never assert.
 *
 * <p>Bounded below {@link CASE_TIMEOUT_MS} so a single stall is named by
 * this deadline rather than swallowed by Jest's generic case timeout. A
 * bank replays in a few seconds, so one stall fires here at ~30s against
 * a 300s case. Many simultaneously slow-but-passing fixtures could still
 * reach the case timeout first, but that is systemic degradation, where
 * naming one fixture is not the useful signal anyway.
 */
const LOAD_TIMEOUT_MS = 30_000;

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
 * Markup whose only purpose is to leave state behind it.
 *
 * <p>Both halves are drawn from observed behaviour, not imagination:
 * replaying Leumi's 66 captures through one document raises
 * "redeclaration of non-configurable global property g", which is a real
 * fixture's `var` colliding with an earlier fixture's.
 */
const REALM_LEAK_MARKUP = [
  '<html><body><script>',
  "  window.__leaked = 'yes';",
  '  var g = 1;',
  '</script></body></html>',
].join('\n');

/** Trivial healthy document, replayed after the leak to sample the realm. */
const CLEAN_MARKUP = '<html><body><h1>ok</h1></body></html>';

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
 * Describe a fixture load failure without guessing at its cause.
 *
 * <p>`setContent` also rejects when the page closed, the browser died or
 * the execution context went away. Reporting those as a timeout sends
 * whoever reads the red build looking for a slow fixture that does not
 * exist.
 *
 * @param file - Fixture path that failed.
 * @param cause - Rejection Playwright raised.
 * @returns Message naming the fixture and the failure it actually hit.
 */
function loadFailureMessage(file: string, cause: unknown): string {
  const isTimeout = cause instanceof Error && cause.name === 'TimeoutError';
  if (!isTimeout) return `fixture ${file} failed to load`;
  return `fixture ${file} did not load within ${String(LOAD_TIMEOUT_MS)}ms`;
}

/**
 * Reset the page's realm, then load one fixture into it.
 *
 * <p>The `about:blank` navigation is load-bearing, not hygiene.
 * `setContent` swaps the document but keeps the window, so a fixture's
 * globals, timers and observers outlive it and run against whatever is
 * replayed next — measurably: Leumi's corpus raises a cross-fixture
 * `var` collision without this line and none with it. Since
 * `isErrorDocument` reports any probe failure as `false`, leaked state
 * biases the suite toward silent false negatives.
 *
 * <p>It also costs nothing: a clean realm carries no accumulated timers,
 * which drops the corpus's worst-case load from 3143ms to 631ms.
 *
 * <p>Playwright's own timeout says only that `setContent` expired, which
 * in a 298-file replay identifies nothing. The fixture path is the first
 * thing anyone reading a red build needs.
 *
 * @param page - Page to load into.
 * @param file - Fixture path, used only for the failure message.
 * @param html - Markup to load.
 */
async function loadFixture(page: Page, file: string, html: string): Promise<void> {
  const timeout = LOAD_TIMEOUT_MS;
  try {
    await page.goto('about:blank', { timeout, waitUntil: 'domcontentloaded' });
    await page.setContent(html, { timeout, waitUntil: 'domcontentloaded' });
  } catch (cause) {
    throw new ScraperError(loadFailureMessage(file, cause), { cause });
  }
}

/**
 * Replay markup into a fresh offline page and ask the production probe.
 *
 * <p>Used by the single positive case, which is worth its own context:
 * one page is negligible, and the case that proves the probe fires
 * should not depend on anything replayed before it.
 *
 * @param browser - Shared Camoufox browser.
 * @param html - Markup to replay.
 * @returns The probe's verdict for that markup.
 */
async function classify(browser: Browser, html: string): Promise<boolean> {
  const page: Page = await newFixturePage(browser);
  try {
    await loadFixture(page, '<inline>', html);
    return await isErrorDocument(page);
  } finally {
    await page.context().close();
  }
}

/**
 * Read one fixture off disk and classify it into an already-open page.
 * @param page - Page reused across this bank's corpus.
 * @param file - Fixture path to classify.
 * @returns True when the probe flags this file as an error document.
 */
async function classifyInto(page: Page, file: string): Promise<boolean> {
  const html = await fs.readFile(file, 'utf8');
  await loadFixture(page, file, html);
  return isErrorDocument(page);
}

/**
 * Bind the classify half of a session to one page.
 * @param page - Page to replay every fixture into.
 * @returns Classifier over that page.
 */
function classifierFor(page: Page): IReplaySession['classify'] {
  return (file: string): Promise<boolean> => classifyInto(page, file);
}

/**
 * Bind the close half of a session to one page's context.
 * @param page - Page whose context owns the session.
 * @returns Closer for that context.
 */
function closerFor(page: Page): IReplaySession['close'] {
  return (): Promise<void> => page.context().close();
}

/**
 * Open one page and expose it as a reusable replay session.
 *
 * <p>The whole cost of this suite lives here: a context costs ~1.5s to
 * open, against ~12ms to parse the median fixture. One session per bank
 * replaces one per file.
 *
 * @param browser - Shared Camoufox browser.
 * @returns Session that classifies fixtures into a single page.
 */
async function openReplaySession(browser: Browser): Promise<IReplaySession> {
  const page: Page = await newFixturePage(browser);
  return { classify: classifierFor(page), close: closerFor(page) };
}

/**
 * Bind a replay-session factory to one browser.
 * @param browser - Shared Camoufox browser.
 * @returns Factory opening a session on demand.
 */
function sessionFactory(browser: Browser): () => Promise<IReplaySession> {
  return (): Promise<IReplaySession> => openReplaySession(browser);
}

/**
 * Classify every captured fixture of one bank.
 *
 * <p>Sequential and single-session: each fixture replaces the document
 * of the one before it, which is exactly what the probe reads, so
 * nothing is carried forward that the next fixture does not overwrite.
 *
 * @param bankId - Bank fixture id.
 * @returns Fixture paths the probe flagged as error documents.
 */
async function flaggedFilesFor(bankId: string): Promise<readonly string[]> {
  const browser = await getIntegrationBrowser();
  const files = await findHtmlFilesFor(bankId);
  const open = sessionFactory(browser);
  return flaggedFixtures(open, files);
}

/**
 * One captured page from every bank, for the session-reuse guard.
 *
 * <p>Breadth matters more than depth here: one page per bank exercises
 * 13 different inline-script payloads against a single reused document,
 * which is the widest contamination surface the corpus can offer for
 * the cost of 13 parses.
 *
 * @returns One fixture path per bank that has any.
 */
async function oneFixturePerBank(): Promise<readonly string[]> {
  const pending = BANK_IDS.map(findHtmlFilesFor);
  const perBank = await Promise.all(pending);
  return perBank.flatMap((files): string[] => files.slice(0, 1));
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

  // The lock on realm isolation. `setContent` swaps the document but
  // keeps the window, so one fixture's globals, timers and observers
  // outlive the page that created them and run against the next
  // fixture's markup. `isErrorDocument` turns any probe error into
  // `false`, so leaked state biases this suite toward silent false
  // negatives — the one failure a classification guard must never have.
  it(
    'starts every fixture in a clean realm',
    async () => {
      const browser = await getIntegrationBrowser();
      const page = await newFixturePage(browser);
      try {
        await loadFixture(page, '<leak>', REALM_LEAK_MARKUP);
        await loadFixture(page, '<clean>', CLEAN_MARKUP);
        const hasLeaked = await page.evaluate((): boolean => '__leaked' in globalThis);
        expect(hasLeaked).toBe(false);
      } finally {
        await page.context().close();
      }
    },
    CASE_TIMEOUT_MS,
  );

  // The lock on session reuse. Replaying every bank's markup through one
  // document must leave the verdict of the next fixture untouched — in
  // both directions: the healthy pages stay silent, and the error
  // document still fires after all of them have run before it.
  it(
    'keeps its verdict when fixtures share one replay session',
    async () => {
      const browser = await getIntegrationBrowser();
      const healthy = await oneFixturePerBank();
      const open = sessionFactory(browser);
      expect(healthy).toHaveLength(BANK_IDS.length);
      const flagged = await flaggedFixtures(open, [...healthy, SOFT_404_FIXTURE]);
      expect(flagged).toEqual([SOFT_404_FIXTURE]);
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
