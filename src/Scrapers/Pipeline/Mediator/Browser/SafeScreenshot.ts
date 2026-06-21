import type { Page } from 'playwright-core';

import { getDebug } from '../../Types/Debug.js';

const LOG = getDebug(import.meta.url);

/**
 * Options accepted by {@link safeScreenshot}.
 */
export interface IScreenshotOptions {
  readonly path: string;
  readonly fullPage?: boolean;
}

const PATH_PATTERN = /(?:[a-z]:)?[\\/][\w.\-+/\\]+/gi;
const MAX_REASON_LENGTH = 160;

/**
 * Strip filesystem path tokens (Windows + POSIX, absolute or relative)
 * from a free-form string so they cannot reach the structured log.
 *
 * Internal helper — not exported (Pipeline Rule #15: no primitive-typed
 * exports). The PII-scrub contract is tested end-to-end via {@link safeScreenshot}.
 * @param input - Untrusted text that may contain caller-supplied paths.
 * @returns The input with path runs replaced by the literal `<path>`,
 *   truncated to {@link MAX_REASON_LENGTH} characters.
 */
function scrubPaths(input: string): string {
  return input.replaceAll(PATH_PATTERN, '<path>').slice(0, MAX_REASON_LENGTH);
}

/**
 * Caught-value shape accepted by {@link describeError}. The widest
 * typed alternative to TS's `unknown` for catch clauses — covers
 * every concrete value a `throw` statement can yield without
 * forcing call-sites through an interface bottleneck. Listed
 * explicitly (rather than `unknown`) to satisfy the Pipeline
 * `no-restricted-syntax` rule that bans `unknown` parameter
 * annotations. Internal — not exported.
 */
type CaughtValue = Error | string | number | boolean | object | null | undefined;

/**
 * Describe a thrown {@link Error} — preserves the class name verbatim
 * and path-scrubs the message.
 *
 * @param err - Thrown `Error` instance.
 * @returns Composite `"{name}: {scrubbed message}"` string.
 */
function describeErrorInstance(err: Error): string {
  const scrubbed = scrubPaths(err.message);
  return `${err.name}: ${scrubbed}`;
}

/**
 * Describe a non-`Error`, non-string caught value via {@link JSON.stringify},
 * falling back to a fixed sentinel when the value is not JSON-serialisable.
 *
 * @param err - Caught value of unknown shape.
 * @returns Scrubbed JSON description or `'unknown error'` on serialise failure.
 */
function describeNonStringError(err: CaughtValue): string {
  try {
    const json = JSON.stringify(err);
    return scrubPaths(json);
  } catch {
    return 'unknown error';
  }
}

/**
 * Extract a printable error reason without leaking caller-supplied paths.
 * Error class name is preserved verbatim (bounded enum-like surface);
 * the message is path-scrubbed and length-capped.
 *
 * Internal helper — not exported (Pipeline Rule #15: no primitive-typed
 * exports).
 * @param err - Unknown thrown value.
 * @returns A short string suitable for debug logging.
 */
function describeError(err: CaughtValue): string {
  if (err instanceof Error) return describeErrorInstance(err);
  if (typeof err === 'string') return scrubPaths(err);
  return describeNonStringError(err);
}

/**
 * Captures a Playwright page screenshot, swallowing any error so a failed
 * capture stays diagnostic-only and never breaks the surrounding flow.
 *
 * Capture is gated UPSTREAM, not here: the target path originates from
 * `TraceConfig.getScreenshotDir`, which is empty unless the opt-in
 * `FORENSIC_TRACE=true` flag is set (see `TraceConfig.getRunFolder`). When
 * forensic capture is off, callers receive an empty path and skip this
 * function entirely (`BasePhase.takePhaseScreenshot` returns early), so no
 * PNG is ever written by default. When forensic capture is on, the full run
 * folder — including `screenshots/` — uploads only to the access-controlled
 * diagnostics store; the public CI artifact glob excludes `screenshots/*.png`,
 * so rendered post-auth pixels never reach a public artifact.
 *
 * On failure the debug payload carries only a path-scrubbed reason (see
 * {@link scrubPaths}), so consumer-supplied directories that may carry PII
 * never reach the structured log stream. See `logging-pii-guidlines.md` §1
 * (preventive masking).
 *
 * @param page - The Playwright page to capture.
 * @param options - Target path and optional fullPage flag.
 * @returns True if a PNG was written; false on error.
 */
export async function safeScreenshot(page: Page, options: IScreenshotOptions): Promise<boolean> {
  try {
    await page.screenshot({ path: options.path, fullPage: options.fullPage ?? false });
    return true;
  } catch (error) {
    LOG.debug({ reason: describeError(error as CaughtValue) }, 'screenshot capture failed');
    return false;
  }
}
