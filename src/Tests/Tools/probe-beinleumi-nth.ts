/**
 * Standalone Playwright probe — verifies the SMART dashboard fix against
 * the real Beinleumi 09-dashboard-pre fixture HTML. Asserts:
 *   1. `[aria-label="תנועות בחשבון"]` matches BOTH pm.mataf AND pm.q077.
 *   2. `.nth(0)` is pm.mataf (legacy), `.nth(1)` is pm.q077 (modern).
 *
 * Run: npx tsx src/Tests/Tools/probe-beinleumi-nth.ts
 */

import * as fs from 'node:fs';

import type { Browser, Locator, Page } from 'playwright-core';

import { launchCamoufox } from '../../Scrapers/Pipeline/Mediator/Browser/CamoufoxLauncher.js';

const FIXTURE = 'C:/tmp/bank-html/BEINLEUMI/09-dashboard-pre/main.html';
const ARIA = 'תנועות בחשבון';
const SELECTOR = `[aria-label="${ARIA}"]`;
const EXPECTED_NTH0_ID = 'pm.mataf.portal.FibiMenu.Onln.TransBalances.PrivateAccountFlow';
const EXPECTED_NTH1_ID = 'pm.q077';

/**
 * Launch Camoufox + load the fixture HTML onto a fresh page.
 * @returns Browser + page tuple ready for selector probing.
 */
async function setupProbePage(): Promise<{ browser: Browser; page: Page }> {
  const html = fs.readFileSync(FIXTURE, 'utf8');
  const browser = await launchCamoufox(true);
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.setContent(html);
  return { browser, page };
}

/**
 * Emit a FAIL line, close the browser, and signal exit code 1.
 * @param browser - Browser to tear down.
 * @param message - Stderr-bound failure description.
 * @returns Exit code 1.
 */
async function failAndClose(browser: Browser, message: string): Promise<1> {
  console.error(message);
  await browser.close();
  return 1;
}

/**
 * Verify the nth(0) id matches expectation. Closes browser on mismatch
 * via failAndClose. Split from assertNthIds per §19.10.
 * @param locator - Selector locator returning multiple matches.
 * @param browser - Browser handle (for cleanup on fail).
 * @returns 0 on match, 1 on mismatch (browser closed).
 */
async function assertNth0Id(locator: Locator, browser: Browser): Promise<0 | 1> {
  const id0 = await locator.nth(0).getAttribute('id');
  console.log(`[PROBE] nth(0) id="${id0 ?? ''}"`);
  if (id0 === EXPECTED_NTH0_ID) return 0;
  return failAndClose(
    browser,
    `FAIL: nth(0) expected id="${EXPECTED_NTH0_ID}", got "${id0 ?? ''}"`,
  );
}

/**
 * Verify the nth(1) id matches expectation. Closes browser on mismatch
 * via failAndClose. Split from assertNthIds per §19.10.
 * @param locator - Selector locator returning multiple matches.
 * @param browser - Browser handle (for cleanup on fail).
 * @returns 0 on match, 1 on mismatch (browser closed).
 */
async function assertNth1Id(locator: Locator, browser: Browser): Promise<0 | 1> {
  const id1 = await locator.nth(1).getAttribute('id');
  console.log(`[PROBE] nth(1) id="${id1 ?? ''}"`);
  if (id1 === EXPECTED_NTH1_ID) return 0;
  return failAndClose(
    browser,
    `FAIL: nth(1) expected id="${EXPECTED_NTH1_ID}", got "${id1 ?? ''}"`,
  );
}

/**
 * Verify locator.nth(0) and nth(1) carry the expected ids — closes
 * the browser via failAndClose on mismatch.
 * @param locator - Selector locator returning multiple matches.
 * @param browser - Browser handle (for cleanup on fail).
 * @returns 0 on success, 1 on mismatch (browser already closed).
 */
async function assertNthIds(locator: Locator, browser: Browser): Promise<0 | 1> {
  const nth0 = await assertNth0Id(locator, browser);
  if (nth0 === 1) return 1;
  return assertNth1Id(locator, browser);
}

/**
 * Assert the selector matches exactly 2 DOM elements. Closes browser
 * via failAndClose on mismatch. Split from main per §19.10.
 * @param locator - Selector locator.
 * @param browser - Browser handle (for cleanup on fail).
 * @returns 0 on match, 1 on mismatch (browser closed).
 */
async function assertSelectorMatchCount(locator: Locator, browser: Browser): Promise<0 | 1> {
  const count = await locator.count();
  console.log(`[PROBE] aria-label "${ARIA}" matches ${String(count)} DOM elements`);
  if (count === 2) return 0;
  return failAndClose(browser, `FAIL: expected 2 matches, got ${String(count)}`);
}

/** PASS-banner text emitted at the end of a successful probe run. */
const PROBE_PASS_BANNER =
  '[PROBE] PASS: smart fix would click pm.mataf (nth=0) → goback (no URL change) → pm.q077 (nth=1) → URL=/transactions ✓';

/**
 * Emit the PASS banner via console.log — extracted per §19.10.
 * @returns Always 0 (success exit code) so callers can return it directly.
 */
function logProbeSuccess(): 0 {
  console.log(PROBE_PASS_BANNER);
  return 0;
}

/**
 * Run the probe body once setup is complete. Split from main per §19.10
 * so main only owns the setup → run → teardown try/finally.
 * @param page - Probe page loaded with the fixture HTML.
 * @param browser - Browser handle (for cleanup on fail).
 * @returns 0 on success, 1 on assertion failure (browser closed on fail).
 */
async function runProbeAssertions(page: Page, browser: Browser): Promise<0 | 1> {
  const locator = page.locator(SELECTOR);
  const count = await assertSelectorMatchCount(locator, browser);
  if (count === 1) return 1;
  const nth = await assertNthIds(locator, browser);
  if (nth === 1) return 1;
  return logProbeSuccess();
}

/**
 * Close the browser if it is still open. Swallows the late-close error
 * because helpers like failAndClose may have already closed it.
 * @param browser - Browser handle that may already be closed.
 * @returns Always true so callers can return it directly (no `void`).
 */
async function closeIfOpen(browser: Browser): Promise<true> {
  try {
    await browser.close();
  } catch {
    // Browser was already closed by failAndClose — late-close throws "Browser closed".
  }
  return true;
}

/**
 * Probe entrypoint — guarantees browser cleanup on every exit path
 * via try/finally (CR cycle 2 outside-diff fix).
 * @returns 0 on success, 1 on failure.
 */
async function main(): Promise<0 | 1> {
  const { browser, page } = await setupProbePage();
  try {
    return await runProbeAssertions(page, browser);
  } finally {
    await closeIfOpen(browser);
  }
}

main()
  .then((code): never => process.exit(code))
  .catch((error: unknown): never => {
    console.error(error);
    return process.exit(1);
  });
