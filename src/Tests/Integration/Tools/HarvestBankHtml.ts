#!/usr/bin/env tsx
/**
 * Bank HTML harvester for Mode-A integration fixtures.
 *
 * Drives a real Camoufox browser through a per-bank recipe (URL +
 * step navigation) and writes the captured DOM snapshots to
 * `src/Tests/Integration/fixtures/banks/<bankId>/`:
 *
 * <ol>
 *   <li>`<step>.html` — flat main-frame snapshot consumed by
 *       {@link ../Helpers/FixturePage} (`loadStep`).</li>
 *   <li>`<step>/main.html` — per-step main-frame snapshot.</li>
 *   <li>`<step>/frame-N.html` + `<step>/frames.json` — per-frame
 *       snapshots for inspection.</li>
 * </ol>
 *
 * PII is redacted at write time (Option A — capture + redact) via
 * {@link PII_REPLACEMENTS} which scrubs Hebrew ID, phone, and email
 * patterns before bytes touch disk.
 *
 * Usage:
 * ```
 *   npx tsx src/Tests/Integration/Tools/HarvestBankHtml.ts <bankId>
 * ```
 *
 * The recipe table is intentionally minimal — adding a new bank means
 * adding a {@link IBankRecipe} entry and registering it in
 * {@link BANK_RECIPES}.
 */

import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { setTimeout as wait } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';

import type { Browser, Frame, Page } from 'playwright-core';

import { buildContextOptions } from '../../../Common/Browser.js';
import { launchCamoufox } from '../../../Common/CamoufoxLauncher.js';
import ScraperError from '../../../Scrapers/Base/ScraperError.js';

const HERE_PATH = fileURLToPath(import.meta.url);
const HERE_DIR = dirname(HERE_PATH);
const REPO_ROOT = join(HERE_DIR, '..', '..', '..', '..');
const FIXTURES_ROOT = join(REPO_ROOT, 'src', 'Tests', 'Integration', 'fixtures', 'banks');

const SETTLE_AFTER_GOTO_MS = 1500;
const SETTLE_AFTER_REVEAL_MS = 1500;
const PAGE_GOTO_TIMEOUT_MS = 45000;
const FRAME_UNAVAILABLE_HTML = '<!-- frame content unavailable -->';

/**
 * PII redaction rules — each pair is `[pattern, replacement]`. Order
 * matters: narrower patterns must come before broader ones.
 */
const PII_REPLACEMENTS: readonly (readonly [RegExp, string])[] = [
  [/\b\d{9}\b/g, '[redacted-id]'],
  [/\b05\d[-\s]?\d{7}\b/g, '[redacted-phone]'],
  [/[\w.+-]+@[\w-]+\.[\w.-]+/g, '[redacted-email]'],
];

/** One step in a bank recipe. */
interface IRecipeStep {
  readonly stepName: string;
  /** Absolute URL to navigate to (only set on steps that change URL). */
  readonly url?: string;
  /** Visible text of an element to click after navigation (REVEAL action). */
  readonly revealText?: string;
}

/** Per-bank capture recipe. */
interface IBankRecipe {
  readonly bankId: string;
  readonly steps: readonly IRecipeStep[];
}

/**
 * Per-bank recipes — banks not listed here cannot be auto-harvested;
 * fixtures must be captured manually and committed.
 */
const BANK_RECIPES: Readonly<Partial<Record<string, IBankRecipe>>> = {
  isracard: {
    bankId: 'isracard',
    steps: [
      { stepName: '02-pre-login', url: 'https://digital.isracard.co.il' },
      { stepName: '03-after-flip', revealText: 'או כניסה עם סיסמה קבועה' },
    ],
  },
  amex: {
    bankId: 'amex',
    steps: [
      { stepName: '02-pre-login', url: 'https://digital.americanexpress.co.il' },
      { stepName: '03-after-flip', revealText: 'או כניסה עם סיסמה קבועה' },
    ],
  },
  hapoalim: {
    bankId: 'hapoalim',
    steps: [
      { stepName: '01-home', url: 'https://www.bankhapoalim.co.il' },
      { stepName: '02-pre-login', url: 'https://login.bankhapoalim.co.il' },
    ],
  },
  discount: {
    bankId: 'discount',
    steps: [
      { stepName: '01-home', url: 'https://www.discountbank.co.il' },
      { stepName: '02-pre-login', url: 'https://start.telebank.co.il/login/#/LOGIN_PAGE' },
    ],
  },
  mercantile: {
    bankId: 'mercantile',
    steps: [
      { stepName: '01-home', url: 'https://www.mercantile.co.il' },
      { stepName: '02-pre-login', url: 'https://start.telebank.co.il/login/#/LOGIN_PAGE' },
    ],
  },
  massad: {
    bankId: 'massad',
    steps: [
      { stepName: '01-home', url: 'https://www.bankmassad.co.il' },
      { stepName: '02-pre-login', url: 'https://online.bankmassad.co.il' },
    ],
  },
  pagi: {
    bankId: 'pagi',
    steps: [
      { stepName: '01-home', url: 'https://www.pagi.co.il' },
      { stepName: '02-pre-login', url: 'https://onlinepagi.bankpoalim.co.il' },
    ],
  },
  otsarHahayal: {
    bankId: 'otsarHahayal',
    steps: [
      { stepName: '01-home', url: 'https://www.bankotsar.co.il' },
      { stepName: '02-pre-login', url: 'https://digital.otsarh.co.il' },
    ],
  },
  beinleumi: {
    bankId: 'beinleumi',
    steps: [
      { stepName: '01-home', url: 'https://www.fibi.co.il' },
      { stepName: '02-modal-opened', revealText: 'כניסה לחשבון' },
      { stepName: '03-after-prelogin', revealText: 'כניסה עם סיסמה' },
    ],
  },
  max: {
    bankId: 'max',
    steps: [
      { stepName: '01-home', url: 'https://www.max.co.il' },
      { stepName: '02-after-entry', revealText: 'כניסה לחשבון' },
      { stepName: '03-after-private', revealText: 'לקוח פרטי' },
      { stepName: '04-reveal-password', revealText: 'סיסמה קבועה' },
    ],
  },
  visaCal: {
    bankId: 'visaCal',
    steps: [
      { stepName: '01-home', url: 'https://www.cal-online.co.il' },
      { stepName: '02-pre-login', revealText: 'כניסה לחשבונך' },
    ],
  },
};

/**
 * Redact PII patterns in HTML before writing to disk.
 * @param html - Raw HTML from the page.
 * @returns Redacted HTML safe to commit.
 */
function redactPii(html: string): string {
  let redacted = html;
  for (const replacement of PII_REPLACEMENTS) {
    redacted = redacted.replace(replacement[0], replacement[1]);
  }
  return redacted;
}

/**
 * Resolve and create the fixture directory for a bank.
 * @param bankId - Canonical bankId.
 * @returns Absolute path to the per-bank fixture root.
 */
async function ensureFixtureRoot(bankId: string): Promise<string> {
  const fixtureRoot = join(FIXTURES_ROOT, bankId);
  await mkdir(fixtureRoot, { recursive: true });
  return fixtureRoot;
}

/** Captured snapshot of a single frame. */
interface IFrameSnapshot {
  readonly html: string;
  readonly url: string;
}

/** Bundle returned by {@link captureFrames}. */
interface ICapturedSnapshot {
  readonly mainHtml: string;
  readonly frames: readonly IFrameSnapshot[];
}

/**
 * Capture HTML of a single frame, falling back to a sentinel on error.
 * @param frame - The frame to capture.
 * @returns Frame snapshot.
 */
async function captureOneFrame(frame: Frame): Promise<IFrameSnapshot> {
  const url = frame.url();
  try {
    const html = await frame.content();
    return { html, url };
  } catch {
    return { html: FRAME_UNAVAILABLE_HTML, url };
  }
}

/**
 * Capture main-frame HTML + each child-frame HTML for the current page.
 * @param page - Playwright page after navigation/reveal settled.
 * @returns Captured snapshot bundle.
 */
async function captureFrames(page: Page): Promise<ICapturedSnapshot> {
  const mainHtml = await page.content();
  const frames = page.frames();
  const captures = frames.map(frame => captureOneFrame(frame));
  const resolved = await Promise.all(captures);
  return { mainHtml, frames: resolved };
}

/** Metadata row written to `frames.json`. */
interface IFrameMetaRow {
  readonly index: number;
  readonly url: string;
  readonly file: string;
}

/**
 * Build the per-frame write task: returns `[fileName, content, meta]`.
 * @param snapshot - One frame's snapshot.
 * @param index - Index of the frame inside the page.
 * @returns Tuple of `(fileName, content, metaRow)`.
 */
function buildFrameWriteTask(
  snapshot: IFrameSnapshot,
  index: number,
): readonly [string, string, IFrameMetaRow] {
  const fileName = `frame-${String(index)}.html`;
  const content = redactPii(snapshot.html);
  const meta: IFrameMetaRow = { index, url: snapshot.url, file: fileName };
  return [fileName, content, meta] as const;
}

/** Bundle for writeStepArtifacts to keep its body lean. */
interface IWriteStepArgs {
  readonly fixtureRoot: string;
  readonly stepName: string;
  readonly snapshot: ICapturedSnapshot;
}

/**
 * Build the per-step main-frame writes (flat and per-step copies).
 * @param args - Write bundle.
 * @param stepDir - Per-step directory under the fixture root.
 * @returns Pending write promises.
 */
function buildMainHtmlWrites(args: IWriteStepArgs, stepDir: string): readonly Promise<void>[] {
  const redactedMain = redactPii(args.snapshot.mainHtml);
  const flatName = `${args.stepName}.html`;
  const stepMainPath = join(stepDir, 'main.html');
  const flatPath = join(args.fixtureRoot, flatName);
  return [writeFile(stepMainPath, redactedMain, 'utf8'), writeFile(flatPath, redactedMain, 'utf8')];
}

/**
 * Build the per-frame writes (one file per frame).
 * @param tasks - Pre-built frame write tasks.
 * @param stepDir - Per-step directory under the fixture root.
 * @returns Pending write promises.
 */
function buildFrameWrites(
  tasks: readonly (readonly [string, string, IFrameMetaRow])[],
  stepDir: string,
): readonly Promise<void>[] {
  return tasks.map(([fileName, content]) => {
    const targetPath = join(stepDir, fileName);
    return writeFile(targetPath, content, 'utf8');
  });
}

/**
 * Build the `frames.json` index write for the step.
 * @param tasks - Pre-built frame write tasks (to extract meta from).
 * @param args - Write bundle (for stepName).
 * @param stepDir - Per-step directory under the fixture root.
 * @returns Pending write promise.
 */
function buildFramesIndexWrite(
  tasks: readonly (readonly [string, string, IFrameMetaRow])[],
  args: IWriteStepArgs,
  stepDir: string,
): Promise<void> {
  const meta = tasks.map(([, , row]) => row);
  const indexJson = JSON.stringify({ stepName: args.stepName, frames: meta }, null, 2);
  const indexPath = join(stepDir, 'frames.json');
  return writeFile(indexPath, indexJson, 'utf8');
}

/**
 * Write captured frames + the flat main-frame snapshot for one step.
 * @param args - Fixture root + step name + captured snapshot.
 * @returns Number of files written.
 */
async function writeStepArtifacts(args: IWriteStepArgs): Promise<number> {
  const stepDir = join(args.fixtureRoot, args.stepName);
  await mkdir(stepDir, { recursive: true });
  const frameTasks = args.snapshot.frames.map((snap, idx) => buildFrameWriteTask(snap, idx));
  const mainWrites = buildMainHtmlWrites(args, stepDir);
  const frameWrites = buildFrameWrites(frameTasks, stepDir);
  const indexWrite = buildFramesIndexWrite(frameTasks, args, stepDir);
  const writes = [...mainWrites, ...frameWrites, indexWrite];
  await Promise.all(writes);
  return writes.length;
}

/** Bundle of arguments for {@link executeRecipeStep}. */
interface IStepExecutionArgs {
  readonly page: Page;
  readonly step: IRecipeStep;
  readonly fixtureRoot: string;
}

/**
 * Navigate (if URL is non-empty) and wait for the page to settle.
 * @param page - The Playwright page.
 * @param url - URL to navigate to (or empty string to keep current URL).
 * @returns True after a navigation was performed, false otherwise.
 */
async function navigateIfNeeded(page: Page, url: string): Promise<boolean> {
  if (url === '') return false;
  const gotoOpts = { waitUntil: 'domcontentloaded' as const, timeout: PAGE_GOTO_TIMEOUT_MS };
  await page.goto(url, gotoOpts);
  await wait(SETTLE_AFTER_GOTO_MS);
  return true;
}

/**
 * Click a visible reveal element (if `revealText` is non-empty).
 * @param page - The Playwright page.
 * @param revealText - Visible text to find and click (or empty string).
 * @returns True if a click was performed, false otherwise.
 */
async function revealIfNeeded(page: Page, revealText: string): Promise<boolean> {
  if (revealText === '') return false;
  const reveal = page.getByText(revealText, { exact: false }).first();
  await reveal.click({ timeout: PAGE_GOTO_TIMEOUT_MS });
  await wait(SETTLE_AFTER_REVEAL_MS);
  return true;
}

/**
 * Navigate (if URL set), reveal (if text set), settle, then capture
 * and write artifacts for one step.
 * @param args - Page + step + fixture root.
 * @returns Number of files written for this step.
 */
async function executeRecipeStep(args: IStepExecutionArgs): Promise<number> {
  const stepUrl = args.step.url ?? '';
  const stepReveal = args.step.revealText ?? '';
  await navigateIfNeeded(args.page, stepUrl);
  await revealIfNeeded(args.page, stepReveal);
  const snapshot = await captureFrames(args.page);
  const written = await writeStepArtifacts({
    fixtureRoot: args.fixtureRoot,
    stepName: args.step.stepName,
    snapshot,
  });
  console.log(`  step ${args.step.stepName}: wrote ${String(written)} files`);
  return written;
}

/** Shared per-recipe context threaded through the reducer. */
interface IDriveHelpers {
  readonly page: Page;
  readonly fixtureRoot: string;
}

/**
 * Reducer that processes steps sequentially while keeping a running
 * total. Sequential is required (each step's state depends on the
 * previous), and reduce satisfies `no-await-in-loop`.
 * @param prevPromise - Accumulator promise.
 * @param step - Current step.
 * @param helpers - Shared page + fixture root.
 * @returns Updated running total.
 */
async function reduceStepWritten(
  prevPromise: Promise<number>,
  step: IRecipeStep,
  helpers: IDriveHelpers,
): Promise<number> {
  const prev = await prevPromise;
  const written = await executeRecipeStep({
    page: helpers.page,
    step,
    fixtureRoot: helpers.fixtureRoot,
  });
  return prev + written;
}

/**
 * Build the reducer wrapper closure that binds {@link reduceStepWritten}
 * to a shared helpers bundle so the array reduce only sees `(acc, step)`.
 * @param helpers - Shared per-recipe context.
 * @returns Bound reducer.
 */
function buildStepReducer(
  helpers: IDriveHelpers,
): (acc: Promise<number>, step: IRecipeStep) => Promise<number> {
  return (acc, step) => reduceStepWritten(acc, step, helpers);
}

/**
 * Drive every step of a bank recipe end-to-end.
 * @param browser - Shared Camoufox browser.
 * @param recipe - Bank recipe.
 * @returns Total number of files written across all steps.
 */
async function driveRecipe(browser: Browser, recipe: IBankRecipe): Promise<number> {
  const fixtureRoot = await ensureFixtureRoot(recipe.bankId);
  const ctxOpts = buildContextOptions();
  const context = await browser.newContext(ctxOpts);
  const page = await context.newPage();
  try {
    const helpers: IDriveHelpers = { page, fixtureRoot };
    const initial: Promise<number> = Promise.resolve(0);
    const reducer = buildStepReducer(helpers);
    const total = await recipe.steps.reduce(reducer, initial);
    return total;
  } finally {
    await context.close();
  }
}

/**
 * Parse `bankId` from `process.argv` and look up the recipe.
 * @returns The recipe for the requested bank.
 */
function resolveRecipeFromCli(): IBankRecipe {
  const bankId = process.argv.at(2);
  if (bankId === undefined || bankId.trim() === '') {
    throw new ScraperError('usage: HarvestBankHtml.ts <bankId>');
  }
  const recipe = BANK_RECIPES[bankId];
  if (recipe === undefined) {
    throw new ScraperError(`no recipe registered for bankId "${bankId}"`);
  }
  return recipe;
}

/**
 * CLI entry: parse args, launch browser, drive recipe, close cleanly.
 * @returns Total files written for the recipe.
 */
async function main(): Promise<number> {
  const recipe = resolveRecipeFromCli();
  console.log(`Harvesting fixtures for bankId="${recipe.bankId}"…`);
  const browser = await launchCamoufox(true);
  try {
    const total = await driveRecipe(browser, recipe);
    console.log(`\n✅ ${recipe.bankId}: wrote ${String(total)} files.`);
    return total;
  } finally {
    await browser.close();
  }
}

main().catch((err: unknown) => {
  const message = err instanceof Error ? err.message : String(err);
  console.error(`\n❌ harvest failed: ${message}`);
  process.exit(1);
});
