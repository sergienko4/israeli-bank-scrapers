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

import type { Browser, BrowserContext, Frame, Page } from 'playwright-core';

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
 *
 * <p>reCAPTCHA-token entries are NOT user PII per se, but the upstream
 * payloads are session-bound and we never want them in committed
 * fixtures (they're effectively short-lived secrets that bind to a
 * captured IP). They are scrubbed at write time so re-harvest stays
 * automatic.
 */
const PII_REPLACEMENTS: readonly (readonly [RegExp, string])[] = [
  [/\b\d{9}\b/g, '[redacted-id]'],
  [/\b05\d[-\s]?\d{7}\b/g, '[redacted-phone]'],
  [/[\w.+-]+@[\w-]+\.[\w.-]+/g, '[redacted-email]'],
  [/(<input[^>]*id="recaptcha-token"[^>]*value=")[^"]+(")/gi, '$1REDACTED_RECAPTCHA_TOKEN$2'],
  [/(recaptcha\.anchor\.Main\.init\(\s*)"[^"]+"/g, '$1"REDACTED_RECAPTCHA_PAYLOAD"'],
];

/** One step in a bank recipe. */
interface IRecipeStep {
  readonly stepName: string;
  /** Absolute URL to navigate to (only set on steps that change URL). */
  readonly url?: string;
  /** Visible text of an element to click after navigation (REVEAL action). */
  readonly revealText?: string;
}

/**
 * Per-bank capture recipe (steps only). `bankId` is NOT duplicated
 * here — it is derived from the {@link BANK_RECIPES} map key by
 * {@link toRecipe} so there is one source of truth.
 */
interface IRecipeBody {
  readonly steps: readonly IRecipeStep[];
}

/** Fully-resolved recipe used by the driver — bankId + steps. */
interface IBankRecipe {
  readonly bankId: string;
  readonly steps: readonly IRecipeStep[];
}

/**
 * Per-bank recipes — the map key IS the bankId. Adding a new bank
 * means adding a key + steps; no duplicate bankId field.
 */
const BANK_RECIPES: Readonly<Partial<Record<string, IRecipeBody>>> = {
  isracard: {
    steps: [
      { stepName: '02-pre-login', url: 'https://digital.isracard.co.il' },
      { stepName: '03-after-flip', revealText: 'או כניסה עם סיסמה קבועה' },
    ],
  },
  amex: {
    steps: [
      { stepName: '02-pre-login', url: 'https://digital.americanexpress.co.il' },
      { stepName: '03-after-flip', revealText: 'או כניסה עם סיסמה קבועה' },
    ],
  },
  hapoalim: {
    steps: [
      { stepName: '01-home', url: 'https://www.bankhapoalim.co.il' },
      { stepName: '02-pre-login', url: 'https://login.bankhapoalim.co.il' },
    ],
  },
  discount: {
    steps: [
      { stepName: '01-home', url: 'https://www.discountbank.co.il' },
      { stepName: '02-pre-login', url: 'https://start.telebank.co.il/login/#/LOGIN_PAGE' },
    ],
  },
  mercantile: {
    steps: [
      { stepName: '01-home', url: 'https://www.mercantile.co.il' },
      { stepName: '02-pre-login', url: 'https://start.telebank.co.il/login/#/LOGIN_PAGE' },
    ],
  },
  massad: {
    steps: [
      { stepName: '01-home', url: 'https://www.bankmassad.co.il' },
      { stepName: '02-pre-login', url: 'https://online.bankmassad.co.il' },
    ],
  },
  pagi: {
    steps: [
      { stepName: '01-home', url: 'https://www.pagi.co.il' },
      { stepName: '02-pre-login', url: 'https://onlinepagi.bankpoalim.co.il' },
    ],
  },
  otsarHahayal: {
    steps: [
      { stepName: '01-home', url: 'https://www.bankotsar.co.il' },
      { stepName: '02-pre-login', url: 'https://digital.otsarh.co.il' },
    ],
  },
  beinleumi: {
    steps: [
      { stepName: '01-home', url: 'https://www.fibi.co.il' },
      { stepName: '02-modal-opened', revealText: 'כניסה לחשבון' },
      { stepName: '03-after-prelogin', revealText: 'כניסה עם סיסמה' },
    ],
  },
  max: {
    steps: [
      { stepName: '01-home', url: 'https://www.max.co.il' },
      { stepName: '02-after-entry', revealText: 'כניסה לחשבון' },
      { stepName: '03-after-private', revealText: 'לקוח פרטי' },
      { stepName: '04-reveal-password', revealText: 'סיסמה קבועה' },
    ],
  },
  visaCal: {
    steps: [
      { stepName: '01-home', url: 'https://www.cal-online.co.il' },
      { stepName: '02-pre-login', revealText: 'כניסה לחשבונך' },
    ],
  },
};

/**
 * Build the resolved recipe — bundles map key (the bankId) with the
 * steps body, removing the duplicate-bankId smell.
 * @param bankId - The map key (canonical bankId).
 * @param body - The recipe body from {@link BANK_RECIPES}.
 * @returns Fully resolved {@link IBankRecipe}.
 */
function toRecipe(bankId: string, body: IRecipeBody): IBankRecipe {
  return { bankId, steps: body.steps };
}

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
  readonly name: string;
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
  const name = frame.name();
  try {
    const html = await frame.content();
    return { html, url, name };
  } catch {
    return { html: FRAME_UNAVAILABLE_HTML, url, name };
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
  readonly name: string;
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
  const sanitizedUrl = sanitizeFinalUrl(snapshot.url);
  const meta: IFrameMetaRow = { index, name: snapshot.name, url: sanitizedUrl, file: fileName };
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
 * Build the `frames.json` index write for the step. Emits a flat array
 * of `{ index, name, url, file }` rows — matches the on-disk schema
 * already used by the fixture corpus so re-harvest is idempotent.
 * @param tasks - Pre-built frame write tasks (to extract meta from).
 * @param stepDir - Per-step directory under the fixture root.
 * @returns Pending write promise.
 */
function buildFramesIndexWrite(
  tasks: readonly (readonly [string, string, IFrameMetaRow])[],
  stepDir: string,
): Promise<void> {
  const meta = tasks.map(([, , row]) => row);
  const indexJson = JSON.stringify(meta, null, 2);
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
  const indexWrite = buildFramesIndexWrite(frameTasks, stepDir);
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
 * Build the args object passed to {@link writeStepArtifacts}.
 * Trivial factory — exists to keep {@link executeRecipeStep} within
 * the 10-line cap.
 * @param fixtureRoot - Per-bank fixture root.
 * @param step - The recipe step (provides stepName).
 * @param snapshot - Captured snapshot.
 * @returns IWriteStepArgs bundle.
 */
function buildStepArtifactsArgs(
  fixtureRoot: string,
  step: IRecipeStep,
  snapshot: ICapturedSnapshot,
): IWriteStepArgs {
  return { fixtureRoot, stepName: step.stepName, snapshot };
}

/** Result of {@link executeRecipeStep} — files written + page's final URL. */
interface IStepExecutionResult {
  readonly written: number;
  readonly finalUrl: string;
}

/**
 * Navigate + reveal + settle, returning the captured frame snapshot.
 * Extracted to keep {@link executeRecipeStep} under the 10-line cap.
 * @param args - Step execution args (page + step + fixture root).
 * @returns Captured snapshot of all frames at the post-settle state.
 */
async function navigateRevealCapture(args: IStepExecutionArgs): Promise<ICapturedSnapshot> {
  const stepUrl = args.step.url ?? '';
  const stepReveal = args.step.revealText ?? '';
  await navigateIfNeeded(args.page, stepUrl);
  await revealIfNeeded(args.page, stepReveal);
  return captureFrames(args.page);
}

/**
 * Strip the `;params` suffix from each pathname segment.
 * @param pathname - Raw URL pathname (e.g. `/activityi;src=123;type=foo`).
 * @returns Pathname with semicolon params removed (`/activityi`).
 */
function stripPathSemicolons(pathname: string): string {
  const segments = pathname.split('/').map(seg => seg.split(';')[0]);
  return segments.join('/');
}

/**
 * Apply the full sanitization pipeline to a parsed URL: drop basic-auth
 * credentials, search, hash, and any path-embedded `;params`. Handles
 * non-hierarchical schemes (`about:`, `data:`, `javascript:`) where
 * `parsed.origin === "null"` — falls back to `protocol + pathname` so
 * `about:blank` stays `about:blank` (NOT the surprising "nullblank").
 * @param parsed - URL instance (mutated, but only this function uses it).
 * @returns `prefix + sanitizedPathname` (origin for hierarchical, protocol otherwise).
 */
function sanitizeParsedUrl(parsed: URL): string {
  parsed.username = '';
  parsed.password = '';
  parsed.search = '';
  parsed.hash = '';
  const sanitizedPath = stripPathSemicolons(parsed.pathname);
  const prefix = parsed.origin === 'null' ? parsed.protocol : parsed.origin;
  return `${prefix}${sanitizedPath}`;
}

/**
 * Best-effort cleanup for strings the URL parser rejects: drop everything
 * after `#`, then `?`, then any `;params` runs. Avoids raw passthrough so
 * malformed URLs cannot smuggle tracking ids into the fixture.
 * @param raw - URL string that failed `new URL(...)`.
 * @returns Stripped string (origin + path), never raw.
 */
function fallbackSanitize(raw: string): string {
  const noFragment = raw.split('#')[0];
  const noQuery = noFragment.split('?')[0];
  return noQuery.replace(/;[^/]+/g, '');
}

/**
 * Strip query, hash, basic-auth credentials, and path-embedded `;params`
 * from a captured URL before persisting it. MirrorInterceptor only
 * consumes the host portion, but the steps.json / frames.json manifests
 * are committed so tracking ids (DoubleClick `auiddc=`, JSESSIONID,
 * one-shot grant params, semicolon path session tokens) attached to the
 * page URL are PII / data-leak risks — drop them at capture time.
 * @param rawUrl - URL string as reported by `page.url()` / frame.url().
 * @returns Origin + sanitized pathname; safe fallback on parse failure.
 */
function sanitizeFinalUrl(rawUrl: string): string {
  try {
    const parsed = new URL(rawUrl);
    return sanitizeParsedUrl(parsed);
  } catch {
    return fallbackSanitize(rawUrl);
  }
}

/**
 * Navigate (if URL set), reveal (if text set), settle, then capture
 * and write artifacts for one step. Returns both the file count AND
 * the page's final URL (consumed by the steps.json manifest writer).
 * @param args - Page + step + fixture root.
 * @returns Files written + final URL for this step.
 */
async function executeRecipeStep(args: IStepExecutionArgs): Promise<IStepExecutionResult> {
  const snapshot = await navigateRevealCapture(args);
  const stepArgs = buildStepArtifactsArgs(args.fixtureRoot, args.step, snapshot);
  const written = await writeStepArtifacts(stepArgs);
  console.log(`  step ${args.step.stepName}: wrote ${String(written)} files`);
  const rawUrl = args.page.url();
  const finalUrl = sanitizeFinalUrl(rawUrl);
  return { written, finalUrl };
}

/** Single captured-step manifest entry — written to `steps.json`. */
interface ICapturedStepManifest {
  readonly name: string;
  readonly finalUrl: string;
}

/** Accumulator threaded through {@link reduceStepWritten}. */
interface IDriveAccumulator {
  readonly totalWritten: number;
  readonly steps: readonly ICapturedStepManifest[];
}

/** Shared per-recipe context threaded through the reducer. */
interface IDriveHelpers {
  readonly page: Page;
  readonly fixtureRoot: string;
}

/**
 * Reducer that processes steps sequentially while keeping a running
 * total + manifest. Sequential is required (each step's state depends
 * on the previous), and reduce satisfies `no-await-in-loop`.
 * @param prevPromise - Accumulator promise.
 * @param step - Current step.
 * @param helpers - Shared page + fixture root.
 * @returns Updated accumulator with totals + manifest entry appended.
 */
async function reduceStepWritten(
  prevPromise: Promise<IDriveAccumulator>,
  step: IRecipeStep,
  helpers: IDriveHelpers,
): Promise<IDriveAccumulator> {
  const prev = await prevPromise;
  const result = await executeRecipeStep({
    page: helpers.page,
    step,
    fixtureRoot: helpers.fixtureRoot,
  });
  const entry: ICapturedStepManifest = { name: step.stepName, finalUrl: result.finalUrl };
  return { totalWritten: prev.totalWritten + result.written, steps: [...prev.steps, entry] };
}

/**
 * Build the reducer wrapper closure that binds {@link reduceStepWritten}
 * to a shared helpers bundle so the array reduce only sees `(acc, step)`.
 * @param helpers - Shared per-recipe context.
 * @returns Bound reducer.
 */
function buildStepReducer(
  helpers: IDriveHelpers,
): (acc: Promise<IDriveAccumulator>, step: IRecipeStep) => Promise<IDriveAccumulator> {
  return (acc, step) => reduceStepWritten(acc, step, helpers);
}

/**
 * Iterate the recipe's steps via reducer (sequential, preserving
 * `no-await-in-loop`), returning totals + manifest.
 * @param page - Playwright page.
 * @param fixtureRoot - Per-bank fixture root.
 * @param steps - The recipe steps to execute.
 * @returns Accumulator with totalWritten + per-step manifest entries.
 */
async function driveRecipeSteps(
  page: Page,
  fixtureRoot: string,
  steps: readonly IRecipeStep[],
): Promise<IDriveAccumulator> {
  const helpers: IDriveHelpers = { page, fixtureRoot };
  const reducer = buildStepReducer(helpers);
  const initial: Promise<IDriveAccumulator> = Promise.resolve({ totalWritten: 0, steps: [] });
  return steps.reduce(reducer, initial);
}

/**
 * Write the captured-steps manifest (`steps.json`) under the bank
 * fixture root. Consumed at test time by `MirrorInterceptor` to build
 * the redirect-host allow-list, so re-harvested fixtures keep Mode B
 * coverage automatic — no manual post-harvest editing.
 * @param fixtureRoot - Per-bank fixture root.
 * @param steps - Captured-step manifest entries (one per recipe step).
 * @returns True after the manifest is persisted.
 */
async function writeStepsManifest(
  fixtureRoot: string,
  steps: readonly ICapturedStepManifest[],
): Promise<true> {
  const path = join(fixtureRoot, 'steps.json');
  const json = JSON.stringify(steps, null, 2);
  await writeFile(path, json, 'utf8');
  console.log(`  manifest: wrote ${path} (${String(steps.length)} steps)`);
  return true;
}

/**
 * Open a fresh browser context with the project's preferred options.
 * Exists so {@link driveRecipe} doesn't have to nest the {@link buildContextOptions}
 * call inside `browser.newContext` (forbidden by `no-restricted-syntax`).
 * @param browser - Shared Camoufox browser.
 * @returns A fresh context.
 */
async function openHarvestContext(browser: Browser): Promise<BrowserContext> {
  const opts = buildContextOptions();
  return browser.newContext(opts);
}

/**
 * Drive every step of a bank recipe end-to-end and persist the
 * captured-step manifest (`steps.json`) at the fixture root.
 * @param browser - Shared Camoufox browser.
 * @param recipe - Bank recipe.
 * @returns Total number of files written across all steps.
 */
async function driveRecipe(browser: Browser, recipe: IBankRecipe): Promise<number> {
  const fixtureRoot = await ensureFixtureRoot(recipe.bankId);
  const context = await openHarvestContext(browser);
  const page = await context.newPage();
  try {
    const result = await driveRecipeSteps(page, fixtureRoot, recipe.steps);
    await writeStepsManifest(fixtureRoot, result.steps);
    return result.totalWritten;
  } finally {
    await context.close();
  }
}

/**
 * Parse `bankId` from `process.argv` and look up the recipe body.
 * @returns The resolved recipe for the requested bank.
 */
function resolveRecipeFromCli(): IBankRecipe {
  const bankId = process.argv.at(2);
  if (bankId === undefined || bankId.trim() === '') {
    throw new ScraperError('usage: HarvestBankHtml.ts <bankId>');
  }
  const body = BANK_RECIPES[bankId];
  if (body === undefined) {
    throw new ScraperError(`no recipe registered for bankId "${bankId}"`);
  }
  return toRecipe(bankId, body);
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
