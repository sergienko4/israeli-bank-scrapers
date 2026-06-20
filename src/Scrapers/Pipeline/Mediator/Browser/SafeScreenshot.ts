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
 * Internal helper — not exported. See {@link isPreAuthScreenshot} for
 * the Rule #15 rationale.
 * @param err - Unknown thrown value.
 * @returns A short string suitable for debug logging.
 */
function describeError(err: CaughtValue): string {
  if (err instanceof Error) return describeErrorInstance(err);
  if (typeof err === 'string') return scrubPaths(err);
  return describeNonStringError(err);
}

/**
 * Attempt the underlying Playwright `page.screenshot()` call, swallowing
 * any error so failures stay diagnostic-only. Extracted so
 * {@link safeScreenshot} keeps the CI-gating guard as its sole top-level
 * branch under the per-function cap.
 *
 * @param page - Playwright page to capture.
 * @param options - Target path and optional fullPage flag.
 * @returns True if a PNG was written; false on error.
 */
async function captureScreenshot(page: Page, options: ISafeScreenshotOptions): Promise<boolean> {
  try {
    await page.screenshot({ path: options.path, fullPage: options.fullPage ?? false });
    return true;
  } catch (error) {
    LOG.debug({ reason: describeError(error as CaughtValue) }, 'screenshot capture failed');
    return false;
  }
}

/**
 * Fail-closed CI detection for the screenshot PII gate. Resolves to true
 * (treat the environment as CI and suppress post-auth screenshots) for
 * EVERY value except an explicit `CI=false` opt-out (case-insensitive,
 * whitespace-trimmed). Absent, empty, `CI=true`, `CI=1`, `CI=0`, or any
 * other value all resolve to CI, so user financial data can never reach a
 * public CI artifact by accident. GitHub Actions always sets `CI=true`,
 * so the only path to the not-CI branch is a deliberate local `CI=false`.
 *
 * See `coding-principle-guidlines.md` §4 (Default Deny) and
 * `logging-pii-guidlines.md` §1 (preventive masking).
 * @returns True unless `CI` is explicitly the literal `false`.
 */
function isCi(): boolean {
  return process.env.CI?.trim().toLowerCase() !== 'false';
}

/**
 * Rewrite a screenshot path so it lands in a sibling `private/` directory
 * the public CI artifact glob `screenshots/*.png` can never match. Replaces
 * the single `screenshots` path segment with `private`, preserving the
 * surrounding POSIX or Windows separator. The run folder's `private/` tree
 * is uploaded only to the access-controlled diagnostics store (write-only
 * pre-authenticated request, short TTL), never to the public artifact.
 *
 * Internal helper — not exported. See {@link isPreAuthScreenshot} for the
 * Rule #15 rationale.
 * @param targetPath - Original `screenshots/<file>.png` path.
 * @returns The same path with the `screenshots` segment renamed `private`.
 */
function toPrivatePath(targetPath: string): string {
  return targetPath.replace(/([\\/])screenshots([\\/])/, '$1private$2');
}

/**
 * Decide whether the CI PII gate must divert this capture away from the
 * public `screenshots/` directory. Post-auth phases under CI are diverted
 * (their pixels may carry rendered user data); pre-auth phases and every
 * local (`CI=false`) run keep writing to the public `screenshots/` dir.
 *
 * Internal helper — not exported. See {@link isPreAuthScreenshot} for the
 * Rule #15 rationale.
 * @param file - Basename of the target screenshot path.
 * @returns True iff the capture must be rerouted to the private dir.
 */
function divertsToPrivate(file: string): boolean {
  return isCi() && !isPreAuthScreenshot(file);
}

/**
 * Captures a Playwright page screenshot behind the CI PII gate.
 *
 * Pre-auth phases (the `init` + `home` allowlist published in
 * `.github/workflows/pr.yml` — see {@link PRE_AUTH_SCREENSHOT_PHASES})
 * always write to the public `screenshots/` dir. Under CI, post-auth
 * phases are diverted (not suppressed) into a sibling `private/` dir via
 * {@link toPrivatePath}: the public upload glob `screenshots/*.png` can
 * never match `private/`, so rendered post-auth pixels never reach a public
 * artifact, while the `private/` tree is uploaded only to the
 * access-controlled diagnostics store (write-only pre-authenticated
 * request, short TTL) for triage. Outside CI (`CI=false`), every phase
 * writes to `screenshots/`.
 *
 * The CI check is fail-closed (see {@link isCi}): every environment is
 * treated as CI unless `CI` is an explicit `false`, so post-auth pixels are
 * diverted by default while a deliberate local `CI=false` restores full
 * public capture. See `coding-principle-guidlines.md` §4 (Default Deny) and
 * `logging-pii-guidlines.md` §1 (preventive masking). The debug payload is
 * reduced to the path basename so consumer-supplied directories that may
 * carry PII never reach the structured log stream.
 *
 * @param page - The Playwright page to capture.
 * @param options - Target path and optional fullPage flag.
 * @returns True if a PNG was written (public or private dir); false on error.
 */
export async function safeScreenshot(
  page: Page,
  options: ISafeScreenshotOptions,
): Promise<boolean> {
  const file = basename(options.path);
  if (!divertsToPrivate(file)) return captureScreenshot(page, options);
  LOG.debug({ file }, 'post-auth screenshot diverted to private CI dir');
  return captureScreenshot(page, { ...options, path: toPrivatePath(options.path) });
}
