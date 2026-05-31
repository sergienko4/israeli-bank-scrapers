/**
 * HCaptchaCheckboxSolver — solves the simple hCaptcha checkbox challenge
 * using the documented Camoufox auto-pass recipe.
 *
 * Recipe (per https://camoufox.com/python/usage/ — "disable_coop" section):
 *   1. Wait for `networkidle` — the challenge JS finishes its handshake.
 *   2. Wait WAF_HYDRATION_WAIT_MS — gives the checkbox its hydration window.
 *   3. Locate the iframe's bounding box on the parent page.
 *   4. Click the iframe centre via page.mouse.click(x, y).
 *
 * Camoufox C++-level `humanize: true` (set in CamoufoxLauncher.ts) drives a
 * curved cursor path with variable timing so hCaptcha's token oracle accepts
 * the click as human. `disable_coop: true` ensures the iframe can postMessage
 * its token back to the parent SPA after the click.
 *
 * Best-effort by contract: returns DidSolve(false) when any step fails —
 * the interceptor will retry on the next poll tick.
 */

import type { ElementHandle, Frame, Page } from 'playwright-core';

import { WAF_HYDRATION_WAIT_MS, WAF_NETWORK_IDLE_TIMEOUT_MS } from './WafChallengeConfig.js';
import type { DidSolve, ISolverArgs } from './WafChallengeTypes.js';

const DID_SOLVE_TRUE = true as DidSolve;
const DID_SOLVE_FALSE = false as DidSolve;

/**
 * Wait for network idle, swallowing the timeout — a busy SPA may never
 * truly idle but the iframe is still clickable.
 * @param page - The Playwright page.
 * @returns Always true once the wait resolves (timeout or idle).
 */
async function waitForSettle(page: Page): Promise<true> {
  await page
    .waitForLoadState('networkidle', { timeout: WAF_NETWORK_IDLE_TIMEOUT_MS })
    .catch((): false => false);
  await page.waitForTimeout(WAF_HYDRATION_WAIT_MS);
  return true;
}

/**
 * Get the iframe's <iframe> element handle defensively.
 * @param frame - The challenge frame.
 * @returns Some handle or false when the frame is detached.
 */
async function getFrameElement(frame: Frame): Promise<ElementHandle | false> {
  try {
    const handle = await frame.frameElement();
    return handle;
  } catch {
    return false;
  }
}

/** Bounding box returned by Playwright — duplicated here to avoid `any`. */
interface IFrameBox {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

/**
 * Read the iframe's bounding box on the parent page, defensively.
 * @param handle - Frame element handle.
 * @returns The box or false when boundingBox() returns null/throws.
 */
async function getBoundingBox(handle: ElementHandle): Promise<IFrameBox | false> {
  try {
    const box = await handle.boundingBox();
    return box ?? false;
  } catch {
    return false;
  }
}

/**
 * Click the centre of a bounding box via the page-level mouse (Camoufox
 * humanize converts this into a curved cursor approach).
 * @param page - Playwright page.
 * @param box - Iframe bounding box.
 * @returns True after the click resolves.
 */
async function clickCentre(page: Page, box: IFrameBox): Promise<true> {
  const x = box.x + box.width / 2;
  const y = box.y + box.height / 2;
  await page.mouse.click(x, y);
  return true;
}

/**
 * Resolve the iframe bounding box defensively — wrapper over getBoundingBox
 * kept for symmetry with getFrameElement.
 * @param handle - Frame element handle.
 * @returns The box or false sentinel.
 */
async function readBox(handle: ElementHandle): Promise<IFrameBox | false> {
  const box = await getBoundingBox(handle);
  return box;
}

/**
 * Run the documented Camoufox auto-pass recipe on a hCaptcha checkbox.
 * @param args - Page + frame bundle from the interceptor.
 * @returns DidSolve(true) on successful click, DidSolve(false) on any step failure.
 */
async function solveHCaptchaCheckbox(args: ISolverArgs): Promise<DidSolve> {
  await waitForSettle(args.page);
  const handle = await getFrameElement(args.frame);
  if (handle === false) return DID_SOLVE_FALSE;
  const box = await readBox(handle);
  if (box === false) return DID_SOLVE_FALSE;
  await clickCentre(args.page, box);
  return DID_SOLVE_TRUE;
}

export {
  clickCentre,
  getBoundingBox,
  getFrameElement,
  readBox,
  solveHCaptchaCheckbox,
  waitForSettle,
};
export type { IFrameBox };
