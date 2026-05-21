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

const PATH_PATTERN = /(?:[a-z]:)?[\\/][\w.\-+/\\]+/gi;
const MAX_REASON_LENGTH = 160;

/**
 * Strip filesystem path tokens (Windows + POSIX, absolute or relative)
 * from a free-form string so they cannot reach the structured log.
 * @param input - Untrusted text that may contain caller-supplied paths.
 * @returns The input with path runs replaced by the literal `<path>`,
 *   truncated to {@link MAX_REASON_LENGTH} characters.
 */
export function scrubPaths(input: string): string {
  return input.replace(PATH_PATTERN, '<path>').slice(0, MAX_REASON_LENGTH);
}

/**
 * Extract a printable error reason without leaking caller-supplied paths.
 * Error class name is preserved verbatim (bounded enum-like surface);
 * the message is path-scrubbed and length-capped.
 * @param err - Unknown thrown value.
 * @returns A short string suitable for debug logging.
 */
export function describeError(err: unknown): string {
  if (err instanceof Error) {
    const scrubbed = scrubPaths(err.message);
    return `${err.name}: ${scrubbed}`;
  }
  if (typeof err === 'string') return scrubPaths(err);
  try {
    const json = JSON.stringify(err);
    return scrubPaths(json);
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
