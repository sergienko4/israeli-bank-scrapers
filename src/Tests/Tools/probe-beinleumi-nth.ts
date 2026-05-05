/**
 * Standalone Playwright probe — verifies the SMART dashboard fix against
 * the real Beinleumi 09-dashboard-pre fixture HTML. Asserts:
 *   1. `[aria-label="תנועות בחשבון"]` matches BOTH pm.mataf AND pm.q077.
 *   2. `.nth(0)` is pm.mataf (legacy), `.nth(1)` is pm.q077 (modern).
 *
 * Run: npx tsx src/Tests/Tools/probe-beinleumi-nth.ts
 */

import * as fs from 'node:fs';

import { launchCamoufox } from '../../Scrapers/Pipeline/Mediator/Browser/CamoufoxLauncher.js';

const FIXTURE = 'C:/tmp/bank-html/BEINLEUMI/09-dashboard-pre/main.html';
const ARIA = 'תנועות בחשבון';
const SELECTOR = `[aria-label="${ARIA}"]`;
const EXPECTED_NTH0_ID = 'pm.mataf.portal.FibiMenu.Onln.TransBalances.PrivateAccountFlow';
const EXPECTED_NTH1_ID = 'pm.q077';

/**
 * Probe entrypoint.
 * @returns 0 on success, 1 on failure.
 */
async function main(): Promise<0 | 1> {
  const html = fs.readFileSync(FIXTURE, 'utf8');
  const browser = await launchCamoufox(true);
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.setContent(html);
  const locator = page.locator(SELECTOR);
  const count = await locator.count();
  console.log(`[PROBE] aria-label "${ARIA}" matches ${String(count)} DOM elements`);
  if (count !== 2) {
    console.error(`FAIL: expected 2 matches, got ${String(count)}`);
    await browser.close();
    return 1;
  }
  const id0 = await locator.nth(0).getAttribute('id');
  const id1 = await locator.nth(1).getAttribute('id');
  console.log(`[PROBE] nth(0) id="${id0 ?? ''}"`);
  console.log(`[PROBE] nth(1) id="${id1 ?? ''}"`);
  if (id0 !== EXPECTED_NTH0_ID) {
    console.error(`FAIL: nth(0) expected id="${EXPECTED_NTH0_ID}", got "${id0 ?? ''}"`);
    await browser.close();
    return 1;
  }
  if (id1 !== EXPECTED_NTH1_ID) {
    console.error(`FAIL: nth(1) expected id="${EXPECTED_NTH1_ID}", got "${id1 ?? ''}"`);
    await browser.close();
    return 1;
  }
  console.log(
    '[PROBE] PASS: smart fix would click pm.mataf (nth=0) → goback (no URL change) → pm.q077 (nth=1) → URL=/transactions ✓',
  );
  await browser.close();
  return 0;
}

main()
  .then((code): never => process.exit(code))
  .catch((err: unknown): never => {
    console.error(err);
    return process.exit(1);
  });
