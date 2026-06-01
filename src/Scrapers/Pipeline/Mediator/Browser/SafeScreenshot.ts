import { basename } from 'node:path';

import type { Page } from 'playwright-core';

import { getDebug } from '../../Types/Debug.js';

const LOG = getDebug(import.meta.url);

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
 * Phases whose screenshots are allowed to land in CI artifacts because
 * the rendered DOM cannot contain user-supplied data. Aligned 1:1 with
 * `.github/workflows/pr.yml` (lines 549-552 / 616-618), which documents
 * the upload-artifact path as:
 *
 *   > Pre-auth screenshots (init/home only) included since the bank
 *   > page carries no user data before LOGIN — needed to triage WAF /
 *   > challenge-wall hypotheses without speculation. LOGIN / OTP /
 *   > DASHBOARD / SCRAPE screenshots remain excluded.
 *
 * Keeping the allowlist as a TS const guarantees code + workflow drift
 * is caught by `SafeScreenshotCiPolicy.test.ts` (regression pin).
 */
export const PRE_AUTH_SCREENSHOT_PHASES = Object.freeze(['init', 'home'] as const);

const PRE_AUTH_PHASE_PATTERN = new RegExp(`^[^-]+-(?:${PRE_AUTH_SCREENSHOT_PHASES.join('|')})-`);

/**
 * Tests whether a screenshot basename belongs to a pre-auth phase
 * allowed to surface in CI artifacts. Filenames are produced by
 * `screenshotPath(bank, label)` in `RunLabel.ts` with the format
 * `{bank}-{phaseName}-{stage}-{ts}.png`, so the bank prefix is one
 * dash-free token. Returns false for anything that does not match
 * — including the empty string, malformed names, post-auth phases,
 * and multi-token phase names (`auth-discovery`, `account-resolve`).
 *
 * Internal helper — not exported. The CI-gating contract is tested
 * end-to-end via {@link safeScreenshot}; keeping this primitive-return
 * helper module-local satisfies the Pipeline Rule #15 ban on
 * primitive-typed exports while preserving the policy.
 * @param basename - Filesystem basename of the proposed screenshot.
 * @returns True if the screenshot should be captured even under CI.
 */
function isPreAuthScreenshot(basename: string): boolean {
  return PRE_AUTH_PHASE_PATTERN.test(basename);
}

/**
 * Strip filesystem path tokens (Windows + POSIX, absolute or relative)
 * from a free-form string so they cannot reach the structured log.
 *
 * Internal helper — not exported. See {@link isPreAuthScreenshot} for
 * the Rule #15 rationale.
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
 * Extract a printable error reason without leaking caller-supplied paths.
 * Error class name is preserved verbatim (bounded enum-like surface);
 * the message is path-scrubbed and length-capped.
 *
 * Internal helper — not exported. See {@link isPreAuthScreenshot} for
 * the Rule #15 rationale.
 * @param err - Unknown thrown value.
 * @returns A short string suitable for debug logging.
 */
function describeError(err: CaughtValue): string {
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
 * Captures a Playwright page screenshot. Under CI, capture is restricted
 * to the pre-auth phase allowlist published in `.github/workflows/pr.yml`
 * (lines 549-552 / 616-618 — see `PRE_AUTH_SCREENSHOT_PHASES`) so that
 * rendered post-auth pixels never reach public artifacts while still
 * leaving WAF / challenge-wall failures triageable from `init` + `home`
 * screenshots. Outside CI, every phase captures.
 *
 * The CI check uses truthy semantics for parity with the codebase's
 * other 8 `process.env.CI` reads — note the literal string `'false'`
 * is truthy and will still gate. See `coding-principle-guidlines.md`
 * §4 (Default Deny) and `logging-pii-guidlines.md` §1 (preventive
 * masking). The debug payload is reduced to the path basename so
 * consumer-supplied directories that may carry PII never reach the
 * structured log stream.
 *
 * @param page - The Playwright page to capture.
 * @param options - Target path and optional fullPage flag.
 * @returns True if a PNG was written; false if suppressed or on error.
 */
export async function safeScreenshot(
  page: Page,
  options: ISafeScreenshotOptions,
): Promise<boolean> {
  const file = basename(options.path);
  if (process.env.CI && !isPreAuthScreenshot(file)) {
    LOG.debug({ file }, 'screenshot suppressed in CI');
    return false;
  }
  try {
    await page.screenshot({ path: options.path, fullPage: options.fullPage ?? false });
    return true;
  } catch (error) {
    LOG.debug({ reason: describeError(error as CaughtValue) }, 'screenshot capture failed');
    return false;
  }
}
