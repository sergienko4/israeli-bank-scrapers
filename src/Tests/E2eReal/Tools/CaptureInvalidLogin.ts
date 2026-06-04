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

import type { Browser, BrowserContext, Frame, Locator, Page } from 'playwright-core';

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
  /**
   * Optional override URL pointing directly at the bank's login page.
   * When set, the script navigates straight here instead of starting at
   * the marketing home (`PIPELINE_BANK_CONFIG[id].urls.base`) — necessary
   * for banks whose login lives on a separate host and is reached via a
   * HOME-phase click in production (Discount → telebank, etc.).
   * Generic field, optional per row — no per-bank code branches.
   */
  readonly directLoginUrl?: string;
}

/** Per-bank capture table — read-only data; no branching on bank names elsewhere. */
const CAPTURES: Readonly<Record<BankKey, IBankCaptureConfig>> = {
  discount: {
    bankKey: 'discount',
    companyId: CompanyTypes.Discount,
    postSubmitWaitMs: 8000,
    directLoginUrl: 'https://start.telebank.co.il/login/#/LOGIN_PAGE',
  },
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
  /**
   * URL the script actually navigates to (directLoginUrl if set on the
   * CAPTURES row, else falls back to the bank's PIPELINE_BANK_CONFIG
   * urls.base). Resolved once at parse-time so the rest of the run sees
   * a single, unconditional URL.
   */
  readonly entryUrl: string;
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

/** Resolved bank-config row from PIPELINE_BANK_CONFIG. */
type ResolvedBankCfg = NonNullable<(typeof PIPELINE_BANK_CONFIG)[CompanyTypes]>;

/** Capture row + production bank-config row pair. */
interface IBankCfgPair {
  cfg: IBankCaptureConfig;
  bankCfg: ResolvedBankCfg;
}

/**
 * Look up the per-bank capture row + the production PIPELINE_BANK_CONFIG
 * row for the chosen bank key, throwing when the production row is missing.
 * @param bankKey - Validated CLI bank key.
 * @returns Capture + production bank-config pair.
 */
function lookupBankConfig(bankKey: BankKey): IBankCfgPair {
  const cfg = CAPTURES[bankKey];
  const bankCfg = PIPELINE_BANK_CONFIG[cfg.companyId];
  if (bankCfg === undefined) {
    throw new ScraperError(`PIPELINE_BANK_CONFIG entry missing for ${cfg.companyId}`);
  }
  return { cfg, bankCfg };
}

/**
 * Pick base + entry URLs from the resolved bank rows. `entryUrl` wins
 * over `baseUrl` when the CAPTURES row sets a `directLoginUrl` (banks
 * whose login lives on a separate host).
 * @param cfg - Capture config row.
 * @param bankCfg - Production bank-config row.
 * @returns Resolved URL pair.
 */
function resolveBankUrls(
  cfg: IBankCaptureConfig,
  bankCfg: ResolvedBankCfg,
): { baseUrl: string; entryUrl: string } {
  const baseUrl = bankCfg.urls.base;
  const entryUrl = cfg.directLoginUrl ?? baseUrl;
  return { baseUrl, entryUrl };
}

/**
 * Resolve the CLI bank key from argv. Throws with the usage message
 * (listing valid keys) when no valid key is present.
 * @param argv - process.argv.slice(2).
 * @returns Validated bank key.
 */
function resolveBankKeyOrThrow(argv: readonly string[]): BankKey {
  const bankKey = pickBankKey(argv);
  if (bankKey !== false) return bankKey;
  const keys = Object.keys(CAPTURES).join(', ');
  throw new ScraperError(`Usage: CaptureInvalidLogin <bankKey>. Valid keys: ${keys}`);
}

/** Pre-resolved inputs threaded into assembleCliOptions. */
interface IParseCliResolved {
  bankKey: BankKey;
  isHeadless: boolean;
  timeoutMs: number;
  cfg: IBankCaptureConfig;
  bankCfg: ResolvedBankCfg;
}

/**
 * Combine the pre-resolved inputs into the final ICliOptions bundle.
 * Extracted per §19.10 so `parseCli` stays ≤10 lines.
 * @param r - Pre-resolved CLI inputs.
 * @returns Final CLI options bundle.
 */
function assembleCliOptions(r: IParseCliResolved): ICliOptions {
  const { bankKey, isHeadless, timeoutMs, cfg } = r;
  const outputRoot = path.join('C:', 'tmp', 'bank-html', bankKey);
  const { baseUrl, entryUrl } = resolveBankUrls(cfg, r.bankCfg);
  const { companyId } = cfg;
  return { bankKey, isHeadless, timeoutMs, outputRoot, companyId, baseUrl, entryUrl };
}

/**
 * Parse process.argv into a validated options bundle.
 * @returns CLI options.
 */
function parseCli(): ICliOptions {
  const argv = process.argv.slice(2);
  const bankKey = resolveBankKeyOrThrow(argv);
  const { cfg, bankCfg } = lookupBankConfig(bankKey);
  const isHeadless = argv.includes('--headless');
  const timeoutMs = pickTimeout(argv);
  return assembleCliOptions({ bankKey, isHeadless, timeoutMs, cfg, bankCfg });
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
 * Log a successful input fill (truncated value preview for privacy).
 * Extracted per §19.10 so `fillOneInput` stays ≤10 lines.
 * @param input - Filled input locator (for the name attribute).
 * @param idx - Input index in the visible-inputs collection.
 * @param value - Value used to fill the input (only prefix is logged).
 * @returns Always true (caller propagates as `isFilled` indicator).
 */
async function logFilledInput(input: Locator, idx: number, value: string): Promise<true> {
  const name = await input.getAttribute('name').catch((): string => '');
  LOG.info({ idx, name, value: value.slice(0, 4) + '***' }, 'filled input');
  return true;
}

/**
 * Wrap Playwright's `input.fill(...).then.catch` chain in a single
 * helper so `fillOneInput` stays ≤10 lines per §19.10.
 * @param input - Input locator to fill.
 * @param value - Value to write (already privacy-truncated for logging).
 * @returns True on success, false when the fill rejected.
 */
function tryFillInput(input: Locator, value: string): Promise<boolean> {
  return input
    .fill(value, { timeout: 4000 })
    .then((): boolean => true)
    .catch((): boolean => false);
}

/**
 * Fill one input at a given locator index. Sequential semantics —
 * the locator handle is RE-resolved per call so DOM mutations from
 * earlier fills cannot stale the remaining indices.
 * @param page - Playwright page (re-queried each call).
 * @param idx - Index into the visible-inputs collection.
 * @returns True iff the fill landed; false otherwise (caller logs).
 */
async function fillOneInput(page: Page, idx: number): Promise<boolean> {
  const inputs = page.locator('input:not([type="hidden"]):not([disabled])');
  const input = inputs.nth(idx);
  const value = await chooseCredValue(input);
  const isFilled = await tryFillInput(input, value);
  if (isFilled) return logFilledInput(input, idx, value);
  LOG.warn({ idx }, 'fill failed (input not actionable — skipped)');
  return false;
}

/**
 * Build the sequential-fill reducer for `fillInvalidCreds`. Each step
 * awaits the previous tally and adds 1 on successful fill. Extracted
 * per §19.10.
 * @param page - Playwright page passed to fillOneInput.
 * @returns Reducer function consumed by Array.reduce.
 */
function buildFillReducer(page: Page): (accum: Promise<number>, idx: number) => Promise<number> {
  return (accumPromise: Promise<number>, idx: number): Promise<number> =>
    accumPromise.then(async (acc): Promise<number> => {
      const isFilled = await fillOneInput(page, idx);
      return isFilled ? acc + 1 : acc;
    });
}

/**
 * Query + log the count of visible inputs on the login page. Extracted
 * per §19.10 so `fillInvalidCreds` stays ≤10 lines.
 * @param page - Playwright page at the login URL.
 * @returns Count of inputs the reducer will iterate over.
 */
async function countVisibleInputs(page: Page): Promise<number> {
  const inputs = page.locator('input:not([type="hidden"]):not([disabled])');
  const count = await inputs.count();
  LOG.info({ count }, 'fillInvalidCreds — visible inputs detected');
  return count;
}

/**
 * Fill every visible input with a best-matching invalid credential.
 * SEQUENTIAL — each fill awaits the previous so DOM mutations from
 * one input cannot detach the locator for the next. This was the bug
 * pointed out: `Promise.all` racing meant only the first input would
 * actually land before the form's re-render swept the rest away.
 * @param page - Playwright page at the login URL.
 * @returns Number of inputs successfully filled.
 */
async function fillInvalidCreds(page: Page): Promise<number> {
  const count = await countVisibleInputs(page);
  const indexes = range(count);
  const reduceStep = buildFillReducer(page);
  const seedPromise: Promise<number> = Promise.resolve(0);
  const filledCount = await indexes.reduce(reduceStep, seedPromise);
  LOG.info({ requested: count, filled: filledCount }, 'fillInvalidCreds done');
  return filledCount;
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
 * Build the on-disk filename + path for one captured iframe. Filename
 * carries an index + url-hash slug so re-captures stay stable across runs.
 * @param args - Index + frame + CLI options bundle.
 * @param slug - URL hash slug for filename stability.
 * @returns Absolute output path.
 */
function buildFramePath(args: IWriteFrameArgs, slug: string): string {
  const indexStr = String(args.index);
  const fileName = `login-post-invalid-iframe-${indexStr}-${slug}.html`;
  return path.join(args.opts.outputRoot, fileName);
}

/**
 * Persist a single iframe's HTML to disk + emit the capture log line.
 * Extracted per §19.10 so `writeOneFrame` stays ≤10 lines.
 * @param framePath - Target on-disk path.
 * @param frameUrl - Source frame URL (for the log line).
 * @param html - HTML payload to write.
 * @returns Always true (caller propagates as the success indicator).
 */
async function persistFrameHtml(framePath: string, frameUrl: string, html: string): Promise<true> {
  await writeUtf8(framePath, html);
  LOG.info({ path: framePath, url: frameUrl, bytes: html.length }, 'captured iframe');
  return true;
}

/**
 * Write a single iframe's HTML to disk.
 * @param args - Index + frame + CLI options bundle.
 * @returns True when bytes were written.
 */
async function writeOneFrame(args: IWriteFrameArgs): Promise<boolean> {
  const frameUrl = args.frame.url();
  const slug = urlHash(frameUrl);
  const framePath = buildFramePath(args, slug);
  const html = await args.frame.content().catch((): string => '');
  if (html.length === 0) return false;
  return persistFrameHtml(framePath, frameUrl, html);
}

/**
 * Persist the main frame to its canonical filename under opts.outputRoot.
 * @param page - Playwright page.
 * @param opts - CLI options.
 * @returns Void promise.
 */
async function writeMainFrame(page: Page, opts: ICliOptions): Promise<void> {
  const mainContent = await page.content();
  const mainPath = path.join(opts.outputRoot, 'login-post-invalid.html');
  await writeUtf8(mainPath, mainContent);
  LOG.info({ path: mainPath, bytes: mainContent.length }, 'captured main frame');
}

/**
 * Collect every child iframe under the page (excludes the main frame).
 * @param page - Playwright page.
 * @returns Read-only frames array.
 */
function collectChildFrames(page: Page): readonly Frame[] {
  const mainFrame = page.mainFrame();
  const allFrames = page.frames();
  return allFrames.filter((f): boolean => f !== mainFrame);
}

/**
 * Write every child iframe's HTML in parallel. Returns the count of
 * frames that actually produced bytes (some frames may have empty
 * content during teardown). Extracted per §19.10.
 * @param childFrames - Child frames (main excluded).
 * @param opts - CLI options.
 * @returns Number of iframe files written.
 */
async function writeChildFrames(childFrames: readonly Frame[], opts: ICliOptions): Promise<number> {
  const tasks = childFrames.map(
    (frame, index): Promise<boolean> => writeOneFrame({ index, frame, opts }),
  );
  const results = await Promise.all(tasks);
  return results.filter(Boolean).length;
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
  await writeMainFrame(page, opts);
  const childFrames = collectChildFrames(page);
  const extra = await writeChildFrames(childFrames, opts);
  return 1 + extra;
}

/** One route entry in the scaffold fixtures.json. */
interface IFixtureRouteEntry {
  method: string;
  urlGlob: string;
  fixture: string;
  status: number;
  note: string;
}

/** Top-level shape of the scaffold fixtures.json payload. */
interface IFixturesPayload {
  bankKey: BankKey;
  capturedAt: string;
  finalUrl: string;
  routes: readonly IFixtureRouteEntry[];
}

/** Default GET-login route entry (human adjusts the glob post-capture). */
const SCAFFOLD_LOGIN_ROUTE: IFixtureRouteEntry = {
  method: 'GET',
  urlGlob: '**/login*',
  fixture: 'login.html',
  status: 200,
  note: 'Adjust glob to match the real login URL pattern.',
};

/** Default POST-submit route entry (human adjusts the glob post-capture). */
const SCAFFOLD_SUBMIT_ROUTE: IFixtureRouteEntry = {
  method: 'POST',
  urlGlob: '**/auth/**',
  fixture: 'login-post-invalid.html',
  status: 200,
  note: 'Adjust glob to match the real submit URL pattern.',
};

/** Combined default scaffold route list. */
const SCAFFOLD_ROUTES: readonly IFixtureRouteEntry[] = [
  SCAFFOLD_LOGIN_ROUTE,
  SCAFFOLD_SUBMIT_ROUTE,
];

/**
 * Build the scaffold fixtures.json payload. Extracted per §19.10 so
 * `writeFixturesJson` stays ≤10 lines.
 * @param opts - CLI options.
 * @param finalUrl - URL of the page after form submit.
 * @returns JSON-serialisable scaffold payload.
 */
function buildFixturesPayload(opts: ICliOptions, finalUrl: string): IFixturesPayload {
  return {
    bankKey: opts.bankKey,
    capturedAt: new Date().toISOString(),
    finalUrl,
    routes: SCAFFOLD_ROUTES,
  };
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
  const payload = buildFixturesPayload(opts, finalUrl);
  const text = JSON.stringify(payload, null, 2);
  await writeUtf8(fixturesPath, `${text}\n`);
  LOG.info({ path: fixturesPath }, 'wrote fixtures.json scaffold');
}

/** Browser + context + page tuple kept together for the capture flow. */
interface IBrowserSession {
  readonly browser: Browser;
  readonly context: BrowserContext;
  readonly page: Page;
}

/**
 * Close the browser, swallowing any late-close error. Used by cleanup
 * paths in `bootBrowserSession` where the browser may already be torn
 * down by an earlier failure.
 * @param browser - Browser handle to close.
 * @returns Always true (no `void`).
 */
async function closeQuietly(browser: Browser): Promise<true> {
  await browser.close().catch((): boolean => false);
  return true;
}

/**
 * Open a context + page on an already-launched browser and configure
 * the default timeout. Extracted per §19.10 + so `bootBrowserSession`
 * can wrap it in try/catch for browser cleanup on failure (CR cycle 2).
 * @param browser - Pre-launched Camoufox browser.
 * @param opts - CLI options.
 * @returns Session tuple.
 */
async function buildSessionFromBrowser(
  browser: Browser,
  opts: ICliOptions,
): Promise<IBrowserSession> {
  const context = await browser.newContext();
  const page = await context.newPage();
  page.setDefaultTimeout(opts.timeoutMs);
  return { browser, context, page };
}

/**
 * Launch Camoufox + open a fresh context + page configured with the
 * CLI default timeout. Guarantees the browser is closed if `newContext`,
 * `newPage`, or `setDefaultTimeout` throws (CR cycle 2 — was leaking
 * the browser on those failure paths).
 * @param opts - CLI options.
 * @returns Browser/context/page tuple.
 */
async function bootBrowserSession(opts: ICliOptions): Promise<IBrowserSession> {
  const browser: Browser = await launchCamoufox(opts.isHeadless);
  try {
    return await buildSessionFromBrowser(browser, opts);
  } catch (err) {
    await closeQuietly(browser);
    throw err;
  }
}

/**
 * Navigate to opts.entryUrl + wait for networkidle. Navigation errors
 * propagate (a `page.goto` failure means we never reached the bank's
 * login surface — the capture has nothing to record, so fail fast).
 * The subsequent `waitForLoadState('networkidle')` IS swallowed
 * because bank login pages frequently never reach idle (long-poll
 * trackers, telemetry beacons) and that is not a capture-blocking
 * condition.
 * @param page - Playwright page.
 * @param opts - CLI options.
 * @returns Void promise.
 */
async function navigateToLoginPage(page: Page, opts: ICliOptions): Promise<void> {
  await page.goto(opts.entryUrl);
  const idlePromise = page.waitForLoadState('networkidle');
  await swallowPromise(idlePromise);
}

/**
 * Fill invalid creds + click submit + wait the per-bank settle window.
 * @param page - Playwright page.
 * @param bankCfg - Capture config row.
 * @returns Void promise.
 */
async function performLoginAttempt(page: Page, bankCfg: IBankCaptureConfig): Promise<void> {
  await fillInvalidCreds(page);
  await submitForm(page);
  await page.waitForTimeout(bankCfg.postSubmitWaitMs);
}

/**
 * Emit the two pre-flight log lines (CLI options + Camoufox launch).
 * Single helper keeps main() within the test-helper statement cap.
 * @param opts - CLI options.
 * @param bankCfg - Capture config row.
 * @returns True after both log lines emit.
 */
function logCaptureStart(opts: ICliOptions, bankCfg: IBankCaptureConfig): true {
  LOG.info({ opts }, 'CaptureInvalidLogin starting');
  LOG.info({ bank: bankCfg.bankKey, url: opts.entryUrl }, 'launching Camoufox');
  return true;
}

/**
 * Run the navigate → log → login sequence in one composite step.
 * @param page - Playwright page.
 * @param opts - CLI options.
 * @param bankCfg - Capture config row.
 * @returns Void promise.
 */
async function executeLoginInteraction(
  page: Page,
  opts: ICliOptions,
  bankCfg: IBankCaptureConfig,
): Promise<void> {
  await navigateToLoginPage(page, opts);
  LOG.info({ url: page.url() }, 'initial page ready — filling + submitting');
  await performLoginAttempt(page, bankCfg);
}

/**
 * Save HTML for the main frame + every child iframe AND emit the
 * scaffold fixtures.json. Combined into one step so main() stays
 * within the helper-statement cap.
 * @param session - Browser session tuple.
 * @param opts - CLI options.
 * @param finalUrl - Post-submit URL.
 * @returns Number of HTML files written.
 */
async function persistCaptureArtifacts(
  session: IBrowserSession,
  opts: ICliOptions,
  finalUrl: string,
): Promise<number> {
  const written = await saveFramesToDisk(session.context, session.page, opts);
  await writeFixturesJson(opts, finalUrl);
  return written;
}

/**
 * Run the post-login persistence + final-log step. Extracted from main
 * per §19.10 so the orchestrator stays ≤10 lines.
 * @param session - Browser session tuple.
 * @param opts - CLI options.
 * @returns Number of HTML files written.
 */
async function runCapturePersistence(session: IBrowserSession, opts: ICliOptions): Promise<number> {
  const finalUrl = session.page.url();
  const written = await persistCaptureArtifacts(session, opts, finalUrl);
  LOG.info({ finalUrl, framesWritten: written }, 'capture complete');
  return written;
}

/**
 * Entry — orchestrates the capture end-to-end.
 * @returns Exit code (0 OK, 1 error).
 */
async function main(): Promise<number> {
  const opts = parseCli();
  const bankCfg = CAPTURES[opts.bankKey];
  logCaptureStart(opts, bankCfg);
  const session = await bootBrowserSession(opts);
  await executeLoginInteraction(session.page, opts, bankCfg);
  await runCapturePersistence(session, opts);
  await session.browser.close();
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
  } catch (error) {
    const message = error instanceof Error ? error.message : JSON.stringify(error);
    LOG.error({ err: message }, 'capture failed');
    process.exit(1);
  }
}

await runMain();
