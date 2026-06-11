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
 * the shared {@link import('./PiiRedactor.js').redactPii} helper, which
 * scrubs Hebrew ID, phone, email, reCAPTCHA-token, balance, IBAN, and
 * bearer/JWT/cookie-auth patterns before bytes touch disk.
 *
 * Usage:
 * ```
 *   npx tsx src/Tests/Integration/Tools/HarvestBankHtml.ts <bankId> [--include-post-login]
 * ```
 *
 * Credentials for `--include-post-login` are auto-loaded from `.env`
 * via the `dotenv/config` side-effect import below — operators don't
 * need a special invocation.
 *
 * The recipe table is intentionally minimal — adding a new bank means
 * adding a {@link IBankRecipe} entry and registering it in
 * {@link BANK_RECIPES}.
 */

import 'dotenv/config';

import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { setTimeout as wait } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';

import type { Browser, BrowserContext, Frame, Page } from 'playwright-core';

import { buildContextOptions } from '../../../Common/Browser.js';
import { launchCamoufox } from '../../../Common/CamoufoxLauncher.js';
import type { ILoginConfig } from '../../../Scrapers/Base/Interfaces/Config/LoginConfig.js';
import ScraperError from '../../../Scrapers/Base/ScraperError.js';
import BANK_LOGIN_CONFIGS from '../Banks/BankLoginConfigs.js';
import type { BankCredentials } from './CredentialLoader.js';
import { hasCredentials, loadCredentials } from './CredentialLoader.js';
import {
  clickRevealAnyFrame,
  executeHarvestStep,
  type IStepExecutorArgs,
  type IStepExecutorResult,
  waitForCredentialInputIfNeeded,
} from './HarvestStepExecutors.js';
import {
  dumpManifestTrafficIfMode,
  filterStepsByMode,
  type HarvestMode,
  type IDumpManifestTrafficArgs,
  parseHarvestMode,
} from './ManifestRecorder.js';
import { installResponseBuffer, type IResponseBufferHandle } from './NetworkResponseRecorder.js';
import { redactPii as sharedRedactPii } from './PiiRedactor.js';
import {
  BANK_RECIPES,
  getPostLoginRecipe,
  type IBankRecipe,
  type IRecipeBody,
  type IRecipeStep,
  toRecipe,
} from './PostLoginRecipes.js';
import type { IExtendedRecipe, IHarvestStep } from './RecipeStepTypes.js';

const HERE_PATH = fileURLToPath(import.meta.url);
const HERE_DIR = dirname(HERE_PATH);
const REPO_ROOT = join(HERE_DIR, '..', '..', '..', '..');
const FIXTURES_ROOT = join(REPO_ROOT, 'src', 'Tests', 'Integration', 'fixtures', 'banks');

const SETTLE_AFTER_GOTO_MS = 1500;
const SETTLE_AFTER_REVEAL_MS = 1500;
const PAGE_GOTO_TIMEOUT_MS = 45000;
const FRAME_UNAVAILABLE_HTML = '<!-- frame content unavailable -->';

/**
 * Redact PII patterns in HTML before writing to disk.
 *
 * <p>Thin wrapper around {@link sharedRedactPii} — preserved as a
 * named local function so existing call-sites stay one symbol away
 * and the implementation lives in {@link PiiRedactor} alone.
 *
 * @param html - Raw HTML from the page.
 * @returns Redacted HTML safe to commit.
 */
function redactPii(html: string): string {
  return sharedRedactPii(html);
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

/** Args used by {@link collectStepWrites} to build per-step write tasks. */
interface ICollectStepWritesArgs {
  readonly args: IWriteStepArgs;
  readonly stepDir: string;
  readonly frameTasks: readonly (readonly [string, string, IFrameMetaRow])[];
}

/**
 * Collect all write promises for one step's artifacts.
 *
 * @param spec - Write bundle + step subdir + pre-built frame write tasks.
 * @returns Array of pending write promises.
 */
function collectStepWrites(spec: ICollectStepWritesArgs): readonly Promise<void>[] {
  return [
    ...buildMainHtmlWrites(spec.args, spec.stepDir),
    ...buildFrameWrites(spec.frameTasks, spec.stepDir),
    buildFramesIndexWrite(spec.frameTasks, spec.stepDir),
  ];
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
  const writes = collectStepWrites({ args, stepDir, frameTasks });
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
  await clickRevealAnyFrame(page, revealText, PAGE_GOTO_TIMEOUT_MS);
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
 * Navigate + reveal + (optional) wait-for-credential-input + capture.
 * Extracted to keep {@link executeRecipeStep} under the 10-line cap.
 * @param args - Step execution args (page + step + fixture root).
 * @returns Captured snapshot of all frames at the post-settle state.
 */
async function navigateRevealCapture(args: IStepExecutionArgs): Promise<ICapturedSnapshot> {
  const stepUrl = args.step.url ?? '';
  const stepReveal = args.step.revealText ?? '';
  await navigateIfNeeded(args.page, stepUrl);
  await revealIfNeeded(args.page, stepReveal);
  await waitForCredentialInputIfNeeded(args.page, args.step.waitForCredentialInput);
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
 * Build the step execution args from a helpers bundle + current step.
 *
 * @param helpers - Shared page + fixture root.
 * @param step - The current recipe step.
 * @returns Args bundle for {@link executeRecipeStep}.
 */
function buildStepExecArgs(helpers: IDriveHelpers, step: IRecipeStep): IStepExecutionArgs {
  return { page: helpers.page, step, fixtureRoot: helpers.fixtureRoot };
}

/**
 * Execute one legacy recipe step using the bound helper bundle.
 * @param helpers - Shared page + fixture root.
 * @param step - Current recipe step.
 * @returns Step execution result.
 */
async function executeStepWithHelpers(
  helpers: IDriveHelpers,
  step: IRecipeStep,
): Promise<IStepExecutionResult> {
  const stepArgs = buildStepExecArgs(helpers, step);
  return executeRecipeStep(stepArgs);
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
  const result = await executeStepWithHelpers(helpers, step);
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
 * Snapshot the page + persist it under `<fixtureRoot>/<stepName>/` —
 * shared bridge used by both the legacy reducer and the extended
 * post-login driver so PII redaction + file naming stay in one place.
 * @param page - Playwright page.
 * @param fixtureRoot - Per-bank fixture root.
 * @param stepName - Recipe step name.
 * @returns Number of files written.
 */
async function captureAndWrite(page: Page, fixtureRoot: string, stepName: string): Promise<number> {
  const snapshot = await captureFrames(page);
  const stepArgs = buildStepArtifactsArgs(fixtureRoot, { stepName }, snapshot);
  const written = await writeStepArtifacts(stepArgs);
  return written;
}

/**
 * Bundle threaded through the extended driver — page, fixture root,
 * optional credentials for the login step, optional per-bank
 * {@link ILoginConfig} consumed by {@link executeLoginStep}, and the
 * harvest mode (`'a'` skips `recordResponse` steps for the HTML-only
 * pass; `'b'` runs all steps + dumps the live response buffer to
 * `manifest-traffic.ndjson`).
 */
interface IExtendedDriveArgs {
  readonly page: Page;
  readonly fixtureRoot: string;
  readonly recipe: IExtendedRecipe;
  readonly credentials?: BankCredentials;
  readonly loginConfig?: ILoginConfig;
  readonly harvestMode: HarvestMode;
}

/**
 * Build the snapshot writer closure for the extended driver.
 *
 * @param fixtureRoot - Per-bank fixture root path.
 * @returns Async function that captures + persists a DOM snapshot.
 */
function makeExtendedSnapshotWriter(
  fixtureRoot: string,
): (page: Page, stepName: string) => Promise<void> {
  return (page, stepName) => captureAndWrite(page, fixtureRoot, stepName).then(() => undefined);
}

/** Args used by {@link buildExecutorArgs} to bundle extended drive + buffer. */
interface IBuildExecutorArgsSpec {
  readonly args: IExtendedDriveArgs;
  readonly buffer: IResponseBufferHandle;
}

/**
 * Adapt an {@link IExtendedDriveArgs} bundle + live buffer into the
 * {@link IStepExecutorArgs} struct expected by each executor. Keeps
 * the buffer / snapshot / login-config wiring in ONE place so individual
 * step executors don't need to know the harvest plumbing details — and
 * the per-executor calls stay focused on their kind, which holds them
 * under the 10-line cap.
 * @param spec - Bundle of extended drive args + live response buffer.
 * @returns Executor args bundle.
 */
function buildExecutorArgs(spec: IBuildExecutorArgsSpec): IStepExecutorArgs {
  return {
    page: spec.args.page,
    outDir: spec.args.fixtureRoot,
    writeSnapshot: makeExtendedSnapshotWriter(spec.args.fixtureRoot),
    responseBuffer: spec.buffer,
    credentials: spec.args.credentials,
    loginConfig: spec.args.loginConfig,
  };
}

/**
 * Format the log line for one extended step result.
 *
 * @param result - Executor result to describe.
 * @returns Human-readable log string.
 */
function formatStepLog(result: IStepExecutorResult): string {
  const detail = result.skipped !== undefined ? ` (skipped: ${result.skipped})` : '';
  return `  step ${result.stepName} [${result.kind}]: snapshot=${String(result.snapshotWritten)}${detail}`;
}

/**
 * Log a formatted extended-step result without nesting formatter in console.log.
 * @param result - Executor result to print.
 * @returns True after logging.
 */
function logExtendedStepResult(result: IStepExecutorResult): true {
  const line = formatStepLog(result);
  console.log(line);
  return true;
}

/**
 * Sequential reducer for extended-recipe steps. Logs each step result
 * so the operator can follow the harvest live, and surfaces skips
 * (typically: login-step PR-A2.1 stub or unmatched response patterns)
 * without aborting the rest of the recipe.
 * @param prevPromise - Previous accumulator promise.
 * @param step - Current step.
 * @param executorArgs - Shared executor args.
 * @returns Updated accumulator.
 */
async function reduceExtendedStep(
  prevPromise: Promise<readonly IStepExecutorResult[]>,
  step: IHarvestStep,
  executorArgs: IStepExecutorArgs,
): Promise<readonly IStepExecutorResult[]> {
  const prev = await prevPromise;
  const result = await executeHarvestStep({ step, args: executorArgs });
  logExtendedStepResult(result);
  return [...prev, result];
}

/**
 * Build the reducer closure for extended steps bound to shared executor args.
 *
 * @param executorArgs - Shared per-recipe executor context.
 * @returns Reducer suitable for `Array.reduce`.
 */
function buildExtendedReducer(
  executorArgs: IStepExecutorArgs,
): (
  acc: Promise<readonly IStepExecutorResult[]>,
  step: IHarvestStep,
) => Promise<readonly IStepExecutorResult[]> {
  return (acc, step) => reduceExtendedStep(acc, step, executorArgs);
}

/**
 * Run all extended steps sequentially and return the result list.
 *
 * @param steps - Recipe steps to execute.
 * @param executorArgs - Shared executor args.
 * @returns Per-step executor results in recipe order.
 */
async function runExtendedSteps(
  steps: readonly IHarvestStep[],
  executorArgs: IStepExecutorArgs,
): Promise<readonly IStepExecutorResult[]> {
  const seed: Promise<readonly IStepExecutorResult[]> = Promise.resolve([]);
  const reducer = buildExtendedReducer(executorArgs);
  return steps.reduce(reducer, seed);
}

/**
 * Run the recipe steps via the executor args under a freshly-installed
 * response buffer. Extracted so {@link driveExtendedRecipe} stays
 * under the 10-line cap.
 *
 * @param buffer - Live response buffer installed for the recipe.
 * @param args - Extended drive bundle.
 * @returns Per-step executor results (in recipe order).
 */
async function runStepsWithBuffer(
  buffer: IResponseBufferHandle,
  args: IExtendedDriveArgs,
): Promise<readonly IStepExecutorResult[]> {
  const executorArgs = buildExecutorArgs({ args, buffer });
  return runExtendedSteps(args.recipe.steps, executorArgs);
}

/**
 * Drive a post-login extended recipe over a page that already
 * holds the pre-login state. Installs the response buffer for the
 * lifetime of the recipe + disposes it on the way out. Mode-`'b'`
 * runs additionally dump the buffer to `manifest-traffic.ndjson`.
 * @param args - Extended drive bundle.
 * @returns Per-step executor results (in recipe order).
 */
/**
 * Run the recipe with a managed response buffer; ensures the buffer
 * is disposed regardless of whether the inner driver resolves or throws.
 * @param buffer - Live response buffer to dispose on exit.
 * @param spec - Run-and-dump spec passed straight to {@link runRecipeThenDump}.
 * @returns Per-step executor results in recipe order.
 */
async function disposeBufferAfter(
  buffer: IResponseBufferHandle,
  spec: IRunAndDumpSpec,
): Promise<readonly IStepExecutorResult[]> {
  try {
    return await runRecipeThenDump(spec);
  } finally {
    buffer.dispose();
  }
}

/**
 * Drive a post-login recipe with managed response buffer + optional
 * Mode B traffic dump. Buffer is disposed via {@link disposeBufferAfter}.
 * @param args - Extended drive bundle.
 * @returns Per-step executor results in recipe order.
 */
async function driveExtendedRecipe(
  args: IExtendedDriveArgs,
): Promise<readonly IStepExecutorResult[]> {
  const buffer = installResponseBuffer(args.page);
  const filteredArgs = withFilteredRecipe(args);
  return disposeBufferAfter(buffer, { args, filteredArgs, buffer });
}

/** Inner bundle for {@link runRecipeThenDump}. */
interface IRunAndDumpSpec {
  readonly args: IExtendedDriveArgs;
  readonly filteredArgs: IExtendedDriveArgs;
  readonly buffer: IResponseBufferHandle;
}

/**
 * Execute the step reducer then (mode `'b'` only) dump the live buffer.
 * @param spec - Filtered recipe + original args + live buffer.
 * @returns Per-step executor results in recipe order.
 */
async function runRecipeThenDump(spec: IRunAndDumpSpec): Promise<readonly IStepExecutorResult[]> {
  const results = await runStepsWithBuffer(spec.buffer, spec.filteredArgs);
  const dumpArgs = buildDumpArgs(spec.args, spec.buffer);
  await dumpManifestTrafficIfMode(dumpArgs);
  return results;
}

/**
 * Replace `args.recipe` with the mode-filtered recipe.
 * @param args - Extended drive bundle.
 * @returns Bundle with `recipe.steps` trimmed per harvest mode.
 */
function withFilteredRecipe(args: IExtendedDriveArgs): IExtendedDriveArgs {
  const filteredRecipe = filterStepsByMode(args.recipe, args.harvestMode);
  return { ...args, recipe: filteredRecipe };
}

/**
 * Project the drive bundle onto the {@link dumpManifestTrafficIfMode} arg shape.
 * @param args - Extended drive bundle.
 * @param buffer - Live response buffer.
 * @returns Args bundle for the dump helper.
 */
function buildDumpArgs(
  args: IExtendedDriveArgs,
  buffer: IResponseBufferHandle,
): IDumpManifestTrafficArgs {
  const { harvestMode, recipe, fixtureRoot } = args;
  return { harvestMode, bankId: recipe.bankId, fixtureRoot, buffer };
}

/** Arguments accepted by {@link maybeRunPostLogin} / {@link runPostLoginRecipe}. */
interface IPostLoginRunArgs {
  readonly page: Page;
  readonly fixtureRoot: string;
  readonly bankId: string;
  readonly includePostLogin: boolean;
  readonly harvestMode: HarvestMode;
}

/** Spec bundle for {@link runRecipeInContext} / {@link buildPostLoginRunArgs}. */
interface IRunRecipeSpec {
  readonly helpers: IDriveHelpers;
  readonly recipe: IBankRecipe;
  readonly includePostLogin: boolean;
  readonly harvestMode: HarvestMode;
}

/** Spec bundle for {@link driveRecipe} / {@link harvestWithBrowser}. */
interface IBrowserRecipeSpec {
  readonly browser: Browser;
  readonly recipe: IBankRecipe;
  readonly includePostLogin: boolean;
  readonly harvestMode: HarvestMode;
}

/**
 * Run the recipe steps + write manifest inside an already-opened context.
 *
 * @param spec - Helpers + recipe + include-post-login flag.
 * @returns Total files written across all steps.
 */
async function runRecipeInContext(spec: IRunRecipeSpec): Promise<number> {
  const { helpers, recipe } = spec;
  const result = await driveRecipeSteps(helpers.page, helpers.fixtureRoot, recipe.steps);
  await writeStepsManifest(helpers.fixtureRoot, result.steps);
  const postLoginArgs = buildPostLoginRunArgs(spec);
  const extraWritten = await maybeRunPostLogin(postLoginArgs);
  return result.totalWritten + extraWritten;
}

/**
 * Build the post-login run args bundle from a run-recipe spec.
 * @param spec - Helpers + recipe + include-post-login flag.
 * @returns Bundle ready for {@link maybeRunPostLogin}.
 */
function buildPostLoginRunArgs(spec: IRunRecipeSpec): IPostLoginRunArgs {
  return {
    page: spec.helpers.page,
    fixtureRoot: spec.helpers.fixtureRoot,
    bankId: spec.recipe.bankId,
    includePostLogin: spec.includePostLogin,
    harvestMode: spec.harvestMode,
  };
}

/**
 * Build the {@link IRunRecipeSpec} bundle for a freshly-opened drive context.
 *
 * @param spec - Browser-level spec.
 * @param helpers - Page + fixture root opened for this drive.
 * @returns Spec ready for {@link runRecipeInContext}.
 */
function buildRunRecipeSpec(spec: IBrowserRecipeSpec, helpers: IDriveHelpers): IRunRecipeSpec {
  const { recipe, includePostLogin: shouldIncludePostLogin, harvestMode } = spec;
  return { helpers, recipe, includePostLogin: shouldIncludePostLogin, harvestMode };
}

/** Spec bundle for {@link runRecipeInContextSafely}. */
interface IDriveContextSpec {
  readonly spec: IBrowserRecipeSpec;
  readonly context: BrowserContext;
  readonly fixtureRoot: string;
}

/**
 * Run the recipe in a fresh context tied to the given spec; close the
 * context on the way out regardless of outcome.
 *
 * @param ctx - Browser spec + open context + fixture root.
 * @returns Total number of files written across all steps.
 */
async function runRecipeInContextSafely(ctx: IDriveContextSpec): Promise<number> {
  try {
    const page = await ctx.context.newPage();
    const runSpec = buildRunRecipeSpec(ctx.spec, { page, fixtureRoot: ctx.fixtureRoot });
    return await runRecipeInContext(runSpec);
  } finally {
    await ctx.context.close();
  }
}

/**
 * Drive every step of a bank recipe end-to-end and persist the
 * captured-step manifest (`steps.json`) at the fixture root.
 * @param spec - Browser + recipe + include-post-login flag.
 * @returns Total number of files written across all steps.
 */
async function driveRecipe(spec: IBrowserRecipeSpec): Promise<number> {
  const fixtureRoot = await ensureFixtureRoot(spec.recipe.bankId);
  const context = await openHarvestContext(spec.browser);
  return runRecipeInContextSafely({ spec, context, fixtureRoot });
}

/**
 * Conditionally run the post-login extended recipe for a bank.
 * Returns the number of files written by the extended driver
 * (counted as 1-per-step that emitted a snapshot or response file —
 * approximate, used for reporting only).
 * @param args - Post-login run bundle.
 * @returns Count of files written by post-login steps (approximate).
 */
async function maybeRunPostLogin(args: IPostLoginRunArgs): Promise<number> {
  if (!args.includePostLogin) return 0;
  const recipeOpt = getPostLoginRecipe(args.bankId);
  if (!recipeOpt.has) {
    console.warn(`  no post-login recipe registered for bankId="${args.bankId}" — skipping`);
    return 0;
  }
  const spec = buildPostLoginSpec(args, recipeOpt.value);
  return runPostLoginRecipe(spec);
}

/**
 * Build the extended-drive arg bundle for a post-login run. Resolves
 * the bank's `LoginConfig` from {@link BANK_LOGIN_CONFIGS} so PR-A2.2's
 * `executeLoginStep` can drive `fillAndSubmit` end-to-end; banks without
 * a registered config still complete the recipe (LOGIN step skips
 * cleanly).
 * @param args - Post-login run bundle.
 * @param recipe - Resolved extended recipe.
 * @returns Bundle ready for {@link runPostLoginRecipe}.
 */
function buildPostLoginSpec(
  args: IPostLoginRunArgs,
  recipe: IExtendedDriveArgs['recipe'],
): IExtendedDriveArgs {
  const credentials = hasCredentials(args.bankId) ? loadCredentials(args.bankId) : undefined;
  const loginConfig = BANK_LOGIN_CONFIGS[args.bankId];
  const { page, fixtureRoot, harvestMode } = args;
  return { page, fixtureRoot, recipe, credentials, loginConfig, harvestMode };
}

/**
 * Run an extended recipe + tally an approximate file-count.
 * Snapshots count 1, response captures count 1; skipped steps count 0.
 * @param args - Bundle of page + fixture root + recipe + optional credentials.
 * @returns Approximate file count emitted by extended driver.
 */
async function runPostLoginRecipe(args: IExtendedDriveArgs): Promise<number> {
  const stepCount = String(args.recipe.steps.length);
  console.log(`  → running post-login extended recipe (${stepCount} steps)`);
  const results = await driveExtendedRecipe(args);
  return countWrittenFiles(results);
}

/**
 * Count approximate files written by the extended driver — sum
 * of snapshot + response writes across steps.
 * @param results - Executor results in order.
 * @returns Approximate count.
 */
function countWrittenFiles(results: readonly IStepExecutorResult[]): number {
  return results.reduce(
    (sum, r) => sum + (r.snapshotWritten ? 1 : 0) + (r.responsePath !== undefined ? 1 : 0),
    0,
  );
}

/** CLI parse result — recipe + post-login flag + harvest mode. */
interface IResolvedCli {
  readonly recipe: IBankRecipe;
  readonly includePostLogin: boolean;
  readonly harvestMode: HarvestMode;
}

/**
 * Parse the bankId positional argument from argv or throw.
 *
 * @param args - Sliced process.argv (flags already included).
 * @returns The first non-flag argument.
 */
function parseBankIdArg(args: string[]): string {
  const bankId = args.find(a => !a.startsWith('--'));
  if (!bankId?.trim()) throw new ScraperError('usage: HarvestBankHtml.ts <bankId>');
  return bankId;
}

/**
 * Resolve a recipe body from the recipe map or throw.
 *
 * @param bankId - The bank identifier to look up.
 * @returns The recipe body for the bank.
 */
function lookupRecipeBody(bankId: string): IRecipeBody {
  const body = BANK_RECIPES[bankId];
  if (body === undefined) throw new ScraperError(`no recipe registered for bankId "${bankId}"`);
  return body;
}

/**
 * Parse `bankId` + `--include-post-login` + mode flag from `process.argv`.
 * Phase 11 two-pass: exactly one of `--mode-a-harvest` or `--mode-b-harvest` MUST be supplied.
 * @returns The resolved recipe + post-login flag + mode.
 */
function resolveRecipeFromCli(): IResolvedCli {
  const args = process.argv.slice(2);
  const bankId = parseBankIdArg(args);
  const body = lookupRecipeBody(bankId);
  const recipe = toRecipe(bankId, body);
  const harvestMode = parseHarvestMode(args);
  return { recipe, includePostLogin: args.includes('--include-post-login'), harvestMode };
}

/**
 * Run the recipe with the browser, log the result, and close the browser.
 *
 * @param spec - Browser + recipe + include-post-login flag.
 * @returns Total files written.
 */
async function harvestWithBrowser(spec: IBrowserRecipeSpec): Promise<number> {
  try {
    const total = await driveRecipe(spec);
    console.log(`\n✅ ${spec.recipe.bankId}: wrote ${String(total)} files.`);
    return total;
  } finally {
    await spec.browser.close();
  }
}

/**
 * Build the {@link IBrowserRecipeSpec} bundle for a launched browser + CLI args.
 *
 * @param browser - Launched Camoufox browser.
 * @param cli - Resolved CLI args.
 * @returns Spec ready for {@link harvestWithBrowser}.
 */
function buildBrowserRecipeSpec(browser: Browser, cli: IResolvedCli): IBrowserRecipeSpec {
  return { browser, ...cli };
}

/**
 * CLI entry: parse args, launch browser, drive recipe, close cleanly.
 * @returns Total files written for the recipe.
 */
async function main(): Promise<number> {
  const cli = resolveRecipeFromCli();
  console.log(`Harvesting fixtures for bankId="${cli.recipe.bankId}" mode=${cli.harvestMode}…`);
  const browser = await launchCamoufox(true);
  const browserSpec = buildBrowserRecipeSpec(browser, cli);
  return harvestWithBrowser(browserSpec);
}

main().catch((err: unknown) => {
  const message = err instanceof Error ? err.message : String(err);
  console.error(`\n❌ harvest failed: ${message}`);
  process.exit(1);
});
