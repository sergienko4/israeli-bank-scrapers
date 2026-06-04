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
 * Verify locator.nth(0) and nth(1) carry the expected ids — closes
 * the browser via failAndClose on mismatch.
 * @param locator - Selector locator returning multiple matches.
 * @param browser - Browser handle (for cleanup on fail).
 * @returns 0 on success, 1 on mismatch (browser already closed).
 */
async function assertNthIds(locator: Locator, browser: Browser): Promise<0 | 1> {
  const id0 = await locator.nth(0).getAttribute('id');
  const id1 = await locator.nth(1).getAttribute('id');
  console.log(`[PROBE] nth(0) id="${id0 ?? ''}"`);
  console.log(`[PROBE] nth(1) id="${id1 ?? ''}"`);
  if (id0 !== EXPECTED_NTH0_ID) {
    return failAndClose(
      browser,
      `FAIL: nth(0) expected id="${EXPECTED_NTH0_ID}", got "${id0 ?? ''}"`,
    );
  }
  if (id1 !== EXPECTED_NTH1_ID) {
    return failAndClose(
      browser,
      `FAIL: nth(1) expected id="${EXPECTED_NTH1_ID}", got "${id1 ?? ''}"`,
    );
  }
  return 0;
}

/**
 * Probe entrypoint.
 * @returns 0 on success, 1 on failure.
 */
async function main(): Promise<0 | 1> {
  const { browser, page } = await setupProbePage();
  const locator = page.locator(SELECTOR);
  const count = await locator.count();
  console.log(`[PROBE] aria-label "${ARIA}" matches ${String(count)} DOM elements`);
  if (count !== 2) {
    return failAndClose(browser, `FAIL: expected 2 matches, got ${String(count)}`);
  }
  const result = await assertNthIds(locator, browser);
  if (result === 1) return 1;
  console.log(
    '[PROBE] PASS: smart fix would click pm.mataf (nth=0) → goback (no URL change) → pm.q077 (nth=1) → URL=/transactions ✓',
  );
  await browser.close();
  return 0;
}

main()
  .then((code): never => process.exit(code))
  .catch((error: unknown): never => {
    console.error(error);
    return process.exit(1);
  });
