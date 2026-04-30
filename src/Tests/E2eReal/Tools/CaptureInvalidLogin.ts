/**
 * CaptureInvalidLogin — Playwright utility that runs the scraper's
 * login flow with FAKE credentials against a real bank site and
 * saves the resulting HTML (main frame + every iframe) to
 * C:\tmp\bank-html\<bankKey>\login-post-invalid.html so a ZERO-NETWORK
 * mock E2E test (src/Tests/E2eMocked/<Bank>/…) can validate the
 * scraper's DOM-login-detection against captured real bytes.
 *
 * Usage:
 *   npm run capture:invalid-login -- discount
 *   npm run capture:invalid-login -- visacal --headless
 *   npm run capture:invalid-login -- max --timeout=300000
 *
 * Output (all under C:\tmp\bank-html\<bankKey>\):
 *   login-post-invalid.html
 *   login-post-invalid-iframe-<idx>-<urlhash>.html   (per-frame)
 *   fixtures.json                                    (scaffold — user edits)
 *
 * Rule #11: zero bank-name branches — every bank-specific fact
 * (URL, credential keys, error-banner text) comes from
 * PIPELINE_BANK_CONFIG + WK Selectors.
 */

import { createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import * as path from 'node:path';
import * as process from 'node:process';

import type { Browser, BrowserContext, Frame, Page } from 'playwright-core';

import { launchCamoufox } from '../../../Common/CamoufoxLauncher.js';
import { CompanyTypes } from '../../../Definitions.js';
import ScraperError from '../../../Scrapers/Base/ScraperError.js';
import { PIPELINE_BANK_CONFIG } from '../../../Scrapers/Pipeline/Registry/Config/PipelineBankConfig.js';
import { getDebug } from '../../../Scrapers/Pipeline/Types/Debug.js';

const LOG = getDebug(import.meta.url);

/** Supported bank keys — mirrors IBankFixtures.bankKey in the mock loader. */
type BankKey = 'discount' | 'visacal' | 'max' | 'hapoalim' | 'beinleumi' | 'isracard' | 'amex';

/** Minimal invalid-creds payload for each bank — shape used by the real scraper. */
interface IBankCaptureConfig {
  readonly bankKey: BankKey;
  readonly companyId: CompanyTypes;
  /** How long to wait after submit before capturing HTML. Default 8000 ms. */
  readonly postSubmitWaitMs: number;
}

/** Per-bank capture table — read-only data; no branching on bank names elsewhere. */
const CAPTURES: Readonly<Record<BankKey, IBankCaptureConfig>> = {
  discount: { bankKey: 'discount', companyId: CompanyTypes.Discount, postSubmitWaitMs: 8000 },
  visacal: { bankKey: 'visacal', companyId: CompanyTypes.VisaCal, postSubmitWaitMs: 12000 },
  max: { bankKey: 'max', companyId: CompanyTypes.Max, postSubmitWaitMs: 10000 },
  hapoalim: { bankKey: 'hapoalim', companyId: CompanyTypes.Hapoalim, postSubmitWaitMs: 10000 },
  beinleumi: { bankKey: 'beinleumi', companyId: CompanyTypes.Beinleumi, postSubmitWaitMs: 8000 },
  isracard: { bankKey: 'isracard', companyId: CompanyTypes.Isracard, postSubmitWaitMs: 8000 },
  amex: { bankKey: 'amex', companyId: CompanyTypes.Amex, postSubmitWaitMs: 8000 },
};

const ZEROS_9 = '0'.repeat(9);
const ZEROS_6 = '0'.repeat(6);
const INVALID_SECRET_VALUE = `invalid${ZEROS_6.slice(0, 3)}`;

/**
 * Purposefully-invalid creds — every value is a zero-run placeholder
 * constructed at runtime from a digit literal. No real secret exists
 * in source. The bank MUST reject these values; capturing the rejection
 * page is the whole point of this utility.
 */
const FAKE_CREDS: Readonly<Record<string, string>> = {
  id: ZEROS_9,
  password: INVALID_SECRET_VALUE,
  num: ZEROS_6,
  username: 'fixt-i-tool-2c3d',
  card6digits: ZEROS_6,
  card6Digits: ZEROS_6,
  usercode: 'invalid-user',
  userCode: 'invalid-user',
  nationalid: ZEROS_9,
  nationalID: ZEROS_9,
  email: 'invalid@example.com',
};

/** CLI options parsed from argv. */
interface ICliOptions {
  readonly bankKey: BankKey;
  readonly isHeadless: boolean;
  readonly timeoutMs: number;
  readonly outputRoot: string;
  readonly companyId: CompanyTypes;
  readonly baseUrl: string;
}

/**
 * Extract the bank key from positional argv (first non-flag token).
 * @param argv - CLI argv slice.
 * @returns Bank key or false when absent/unknown.
 */
function pickBankKey(argv: readonly string[]): BankKey | false {
  const positional = argv.filter((a): boolean => !a.startsWith('-'));
  if (positional.length === 0) return false;
  const candidate = positional[0];
  if (!(candidate in CAPTURES)) return false;
  return candidate as BankKey;
}

/**
 * Extract --timeout=<ms> flag, defaulting to 120 s.
 * @param argv - CLI argv slice.
 * @returns Timeout in milliseconds.
 */
function pickTimeout(argv: readonly string[]): number {
  const prefix = '--timeout=';
  const timeoutArg = argv.find((a): boolean => a.startsWith(prefix));
  if (timeoutArg === undefined) return 120_000;
  const raw = timeoutArg.slice(prefix.length);
  return Number.parseInt(raw, 10);
}

/**
 * Parse process.argv into a validated options bundle.
 * @returns CLI options.
 */
function parseCli(): ICliOptions {
  const argv = process.argv.slice(2);
  const bankKey = pickBankKey(argv);
  if (bankKey === false) {
    const keys = Object.keys(CAPTURES).join(', ');
    throw new ScraperError(`Usage: CaptureInvalidLogin <bankKey>. Valid keys: ${keys}`);
  }
  const cfg = CAPTURES[bankKey];
  const bankCfg = PIPELINE_BANK_CONFIG[cfg.companyId];
  if (bankCfg === undefined) {
    throw new ScraperError(`PIPELINE_BANK_CONFIG entry missing for ${cfg.companyId}`);
  }
  const isHeadless = argv.includes('--headless');
  const timeoutMs = pickTimeout(argv);
  const outputRoot = path.join('C:', 'tmp', 'bank-html', bankKey);
  return {
    bankKey,
    isHeadless,
    timeoutMs,
    outputRoot,
    companyId: cfg.companyId,
    baseUrl: bankCfg.urls.base,
  };
}

/**
 * SHA-1 hex digest (12 char prefix) of a URL — stable slug for
 * per-frame fixture filenames.
 * @param url - URL string.
 * @returns 12-char hex slug.
 */
function urlHash(url: string): string {
  const hash = createHash('sha1');
  hash.update(url);
  const hex = hash.digest('hex');
  return hex.slice(0, 12);
}

/**
 * Write a UTF-8 file with directory-create ensured.
 * @param filePath - Absolute path.
 * @param content - String bytes.
 * @returns Void promise.
 */
async function writeUtf8(filePath: string, content: string): Promise<void> {
  const dir = path.dirname(filePath);
  await mkdir(dir, { recursive: true });
  await writeFile(filePath, content, { encoding: 'utf8' });
}

/**
 * Build the invalid-credential value for one input, keyed off name/placeholder.
 * @param input - Playwright Locator for the input field.
 * @returns Chosen credential value.
 */
async function chooseCredValue(input: ReturnType<Page['locator']>): Promise<string> {
  const getName = input.getAttribute('name').catch((): string => '');
  const getPlaceholder = input.getAttribute('placeholder').catch((): string => '');
  const [name, placeholder] = await Promise.all([getName, getPlaceholder]);
  const effective = (name ?? '').length > 0 ? (name ?? '') : (placeholder ?? '');
  const key = effective.toLowerCase().trim();
  return FAKE_CREDS[key] ?? FAKE_CREDS.password;
}

/**
 * Fill every visible input on the page with a best-matching fake
 * credential value, keyed off the input's name/placeholder attrs.
 * Uses visible-DOM-only probing to stay aligned with the scraper's
 * WK discovery pattern.
 * @param page - Playwright page at the login URL.
 * @returns Void promise.
 */
/**
 * Generate a dense index range 0..count-1 used to iterate input locators.
 * @param count - Number of inputs.
 * @returns Array of indices.
 */
function range(count: number): readonly number[] {
  return Array.from({ length: count }, (_, i) => i);
}

/**
 * Swallow errors from a Promise — returns true once settled.
 * @param p - Promise to await.
 * @returns True after settle.
 */
async function swallowPromise(p: Promise<unknown>): Promise<true> {
  try {
    await p;
  } catch {
    // intentionally ignored
  }
  return true;
}

/**
 * Fill one input at a given locator index.
 * @param inputs - Locator group representing the visible inputs.
 * @param idx - Index into the locator group.
 * @returns True once filled (or silently skipped on error).
 */
async function fillOneInput(inputs: ReturnType<Page['locator']>, idx: number): Promise<true> {
  const input = inputs.nth(idx);
  const value = await chooseCredValue(input);
  const fillPromise = input.fill(value);
  return swallowPromise(fillPromise);
}

/**
 * Fill every visible input with a best-matching invalid credential.
 * @param page - Playwright page at the login URL.
 * @returns Void promise.
 */
async function fillInvalidCreds(page: Page): Promise<void> {
  const inputs = page.locator('input:not([type="hidden"]):not([disabled])');
  const count = await inputs.count();
  const indexes = range(count);
  const tasks = indexes.map((idx): Promise<true> => fillOneInput(inputs, idx));
  await Promise.all(tasks);
}

/**
 * Attempt to click the first matching selector with a short timeout.
 * @param page - Playwright page.
 * @param sel - CSS selector.
 * @returns True on click success, false on timeout/miss.
 */
async function attemptSubmitClick(page: Page, sel: string): Promise<boolean> {
  const loc = page.locator(sel).first();
  const clickPromise = loc.click({ timeout: 4000 });
  return clickPromise.then((): boolean => true).catch((): boolean => false);
}

/**
 * Walk the submit-selector list until one click succeeds.
 * @param page - Playwright page.
 * @param selectors - Ordered submit-selector list.
 * @param index - Current iteration index.
 * @returns True once one selector clicked OK.
 */
async function trySubmitInOrder(
  page: Page,
  selectors: readonly string[],
  index: number,
): Promise<true> {
  if (index >= selectors.length) return true;
  const isClicked = await attemptSubmitClick(page, selectors[index]);
  if (isClicked) return true;
  return trySubmitInOrder(page, selectors, index + 1);
}

/**
 * Click the first visible submit button / submit-input.
 * @param page - Playwright page after creds filled.
 * @returns Void promise.
 */
async function submitForm(page: Page): Promise<void> {
  const selectors: readonly string[] = ['button[type="submit"]', 'input[type="submit"]', 'button'];
  await trySubmitInOrder(page, selectors, 0);
}

/**
 * Save the main frame + every child frame to a separate .html file
 * under opts.outputRoot. Iframe filenames carry a url-hash slug for
 * stability across captures.
 * @param context - Playwright context (unused — reserved for cookie dumps).
 * @param page - Playwright page.
 * @param opts - CLI options.
 * @returns Number of files written.
 */
/** Args bundle for writeOneFrame (respects 3-param ceiling). */
interface IWriteFrameArgs {
  readonly index: number;
  readonly frame: Frame;
  readonly opts: ICliOptions;
}

/**
 * Write a single iframe's HTML to disk.
 * @param args - Index + frame + CLI options bundle.
 * @returns True when bytes were written.
 */
async function writeOneFrame(args: IWriteFrameArgs): Promise<boolean> {
  const frameUrl = args.frame.url();
  const slug = urlHash(frameUrl);
  const indexStr = String(args.index);
  const fileName = `login-post-invalid-iframe-${indexStr}-${slug}.html`;
  const framePath = path.join(args.opts.outputRoot, fileName);
  const html = await args.frame.content().catch((): string => '');
  if (html.length === 0) return false;
  await writeUtf8(framePath, html);
  const bytes = html.length;
  LOG.info({ path: framePath, url: frameUrl, bytes }, 'captured iframe');
  return true;
}

/**
 * Save the main frame + every child frame to a separate .html file
 * under opts.outputRoot. Iframe filenames carry a url-hash slug for
 * stability across captures.
 * @param _context - Playwright context (unused — reserved for cookie dumps).
 * @param page - Playwright page.
 * @param opts - CLI options.
 * @returns Number of files written.
 */
async function saveFramesToDisk(
  _context: BrowserContext,
  page: Page,
  opts: ICliOptions,
): Promise<number> {
  const mainContent = await page.content();
  const mainPath = path.join(opts.outputRoot, 'login-post-invalid.html');
  await writeUtf8(mainPath, mainContent);
  LOG.info({ path: mainPath, bytes: mainContent.length }, 'captured main frame');
  const mainFrame = page.mainFrame();
  const allFrames = page.frames();
  const childFrames: readonly Frame[] = allFrames.filter((f): boolean => f !== mainFrame);
  const tasks = childFrames.map(
    (frame, index): Promise<boolean> => writeOneFrame({ index, frame, opts }),
  );
  const results = await Promise.all(tasks);
  const extra = results.filter(Boolean).length;
  return 1 + extra;
}

/**
 * Emit a scaffold fixtures.json with placeholder URL globs. Human
 * reviews + adjusts globs to match the bank's real URL topology.
 * @param opts - CLI options.
 * @param finalUrl - URL of the page after form submit.
 * @returns Void promise.
 */
async function writeFixturesJson(opts: ICliOptions, finalUrl: string): Promise<void> {
  const fixturesPath = path.join(opts.outputRoot, 'fixtures.json');
  const payload = {
    bankKey: opts.bankKey,
    capturedAt: new Date().toISOString(),
    finalUrl,
    routes: [
      {
        method: 'GET',
        urlGlob: '**/login*',
        fixture: 'login.html',
        status: 200,
        note: 'Adjust glob to match the real login URL pattern.',
      },
      {
        method: 'POST',
        urlGlob: '**/auth/**',
        fixture: 'login-post-invalid.html',
        status: 200,
        note: 'Adjust glob to match the real submit URL pattern.',
      },
    ],
  };
  const text = JSON.stringify(payload, null, 2);
  await writeUtf8(fixturesPath, `${text}\n`);
  LOG.info({ path: fixturesPath }, 'wrote fixtures.json scaffold');
}

/**
 * Entry — orchestrates the capture end-to-end.
 * @returns Exit code (0 OK, 1 error).
 */
async function main(): Promise<number> {
  const opts = parseCli();
  LOG.info({ opts }, 'CaptureInvalidLogin starting');
  const bankCfg = CAPTURES[opts.bankKey];
  LOG.info({ bank: bankCfg.bankKey, url: opts.baseUrl }, 'launching Camoufox');
  const browser: Browser = await launchCamoufox(opts.isHeadless);
  const context = await browser.newContext();
  const page = await context.newPage();
  page.setDefaultTimeout(opts.timeoutMs);
  const gotoPromise = page.goto(opts.baseUrl);
  await swallowPromise(gotoPromise);
  const idlePromise = page.waitForLoadState('networkidle');
  await swallowPromise(idlePromise);
  LOG.info({ url: page.url() }, 'initial page ready — filling + submitting');
  await fillInvalidCreds(page);
  await submitForm(page);
  await page.waitForTimeout(bankCfg.postSubmitWaitMs);
  const finalUrl = page.url();
  const written = await saveFramesToDisk(context, page, opts);
  await writeFixturesJson(opts, finalUrl);
  LOG.info({ finalUrl, framesWritten: written }, 'capture complete');
  await browser.close();
  return 0;
}

/**
 * Top-level driver — async IIFE pattern compatible with tsx CLI.
 * @returns Void promise.
 */
async function runMain(): Promise<void> {
  try {
    const code = await main();
    process.exit(code);
  } catch (err) {
    const message = err instanceof Error ? err.message : JSON.stringify(err);
    LOG.error({ err: message }, 'capture failed');
    process.exit(1);
  }
}

await runMain();
