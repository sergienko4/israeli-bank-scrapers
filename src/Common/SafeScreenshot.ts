import { basename } from 'node:path';

import type { Page } from 'playwright-core';

import { getDebug } from './Debug.js';

const LOG = getDebug('safe-screenshot');

/**
 * Options accepted by {@link safeScreenshot}.
 */
export interface ISafeScreenshotOptions {
  readonly path: string;
  readonly fullPage?: boolean;
}

/**
 * Extract a printable error reason without leaking caller-supplied paths.
 * @param err - Unknown thrown value.
 * @returns A short string suitable for debug logging.
 */
function describeError(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (typeof err === 'string') return err;
  try {
    return JSON.stringify(err);
  } catch {
    return 'unknown error';
  }
}

/**
 * Captures a Playwright page screenshot unless CI is active, in which
 * case capture is suppressed to keep rendered post-auth pixels out of
 * public CI artifacts. The CI check uses truthy semantics for parity
 * with the codebase's other 8 `process.env.CI` reads — note the literal
 * string `'false'` is truthy and will still suppress. See
 * `coding-principle-guidlines.md` §4 (Default Deny) and
 * `logging-pii-guidlines.md` §1 (preventive masking). The debug payload
 * is reduced to the path basename so consumer-supplied directories that
 * may carry PII never reach the structured log stream.
 *
 * @param page - The Playwright page to capture.
 * @param options - Target path and optional fullPage flag.
 * @returns True if a PNG was written; false if suppressed or on error.
 */
export async function safeScreenshot(
  page: Page,
  options: ISafeScreenshotOptions,
): Promise<boolean> {
  if (process.env.CI) {
    LOG.debug({ file: basename(options.path) }, 'screenshot suppressed in CI');
    return false;
  }
  try {
    await page.screenshot({ path: options.path, fullPage: options.fullPage ?? false });
    return true;
  } catch (err) {
    LOG.debug({ reason: describeError(err) }, 'screenshot capture failed');
    return false;
  }
}
