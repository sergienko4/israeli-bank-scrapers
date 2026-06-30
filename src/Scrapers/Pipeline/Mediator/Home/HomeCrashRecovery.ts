/**
 * HOME client-side-crash recovery — reload a crashed homepage once, then
 * re-run passive discovery on the fresh mount.
 *
 * <p>Root cause (bank-agnostic): some bank homepages are React/Next.js
 * SPAs that render a top-level error boundary — "Application error: a
 * client-side exception has occurred" — when an async chunk or analytics
 * script throws while the scraper dwells on the page waiting for the
 * login trigger. The trigger DOM is then unmounted, so HOME.PRE's
 * `WK_HOME.ENTRY` race matches nothing and the phase fails with
 * `HOME PRE: no login nav link found`. Observed for Hapoalim on
 * throttled CI runners; the same homepage passes E2E Smoke + Integration
 * because those probes do not dwell long enough to hit the crash.
 *
 * <p>Recovery keys on the framework's own crash text — NOT a provider —
 * so any SPA bank that crashes this way is covered without special-case
 * branching. The reload restores the page to its intended initial
 * homepage state (idempotent recovery, not pipeline progress). On the
 * success path nothing extra runs; when no crash boundary is present the
 * caller's original failure passes through untouched (only two
 * non-blocking crash probes run first) so ordinary "no trigger" failures
 * keep exact behavior.
 */

import type { Page } from 'playwright-core';

import type { ScraperLogger } from '../../Logging/Debug.js';
import type { IPipelineContext } from '../../Types/PipelineContext.js';
import type { Procedure } from '../../Types/Procedure.js';
import type { IElementMediator } from '../Elements/ElementMediator.js';
import { HOME_PRELUDE_TIMEOUT_MS } from '../Timing/TimingConfig.js';
import { type IHomeDiscovery, resolveHomeStrategy } from './HomeResolver.js';

/**
 * Framework client-side crash-boundary markers, substring-matched via
 * `mediator.countByText`. Generic React/Next.js production error-boundary
 * text — extend this list to cover other SPA frameworks' crash strings.
 */
const CLIENT_CRASH_MARKERS = [
  'Application error: a client-side exception',
  'client-side exception has occurred',
] as const;

/** Bundled recovery inputs — keeps every helper at ≤3 params. */
interface IHomeRecoveryArgs {
  readonly mediator: IElementMediator;
  readonly logger: ScraperLogger;
  readonly page: Page;
  readonly baseUrl: string;
}

/**
 * Detect a framework client-side crash boundary on the current page.
 * @param mediator - Element mediator (countByText probe).
 * @returns True when any crash marker text is present.
 */
async function detectClientCrash(mediator: IElementMediator): Promise<boolean> {
  const probes = CLIENT_CRASH_MARKERS.map((marker: string): Promise<number> =>
    mediator.countByText(marker),
  );
  const counts = await Promise.all(probes);
  return counts.some((count: number): boolean => count > 0);
}

/**
 * Reload the homepage so a crashed SPA re-mounts from a clean document.
 * @param args - Bundled mediator, logger, page, baseUrl.
 * @returns Navigation Procedure — `success:false` when the homepage is
 *   unreachable, so the caller can skip a doomed discovery retry.
 */
async function reloadHomepage(args: IHomeRecoveryArgs): Promise<Procedure<void>> {
  args.logger.debug({ event: 'home.client_crash.reload', url: args.baseUrl });
  return args.mediator.navigateTo(args.baseUrl, {
    waitUntil: 'networkidle',
    timeout: HOME_PRELUDE_TIMEOUT_MS,
  });
}

/**
 * Re-run passive discovery after a reload and log the recovery outcome.
 * @param args - Bundled mediator, logger, page, baseUrl.
 * @returns Discovery Procedure from the post-reload pass.
 */
async function retryDiscovery(args: IHomeRecoveryArgs): Promise<Procedure<IHomeDiscovery>> {
  const retry = await resolveHomeStrategy(args.mediator, args.logger, args.page);
  args.logger.debug({ event: 'home.client_crash.retry', recovered: retry.success });
  return retry;
}

/**
 * Warn, reload the crashed homepage, then retry discovery on the fresh
 * mount. When the reload itself fails (homepage unreachable) the
 * caller's `original` failure is returned unchanged — retrying on a
 * still-broken page would only repeat the same failure.
 * @param args - Bundled mediator, logger, page, baseUrl.
 * @param original - Failure from the first discovery pass.
 * @returns Recovered discovery, or `original` when the reload failed.
 */
async function reloadAndRetry(
  args: IHomeRecoveryArgs,
  original: Procedure<IHomeDiscovery>,
): Promise<Procedure<IHomeDiscovery>> {
  args.logger.warn({ event: 'home.client_crash.detected', url: args.baseUrl });
  const reloaded = await reloadHomepage(args);
  if (!reloaded.success) return original;
  return retryDiscovery(args);
}

/**
 * Recover from a client-side crash and retry HOME discovery once.
 * Invoked ONLY on the HOME.PRE failure path: probes for a crash
 * boundary; when absent returns the caller's `original` failure
 * unchanged; when present reloads the homepage once and re-runs passive
 * discovery on the fresh mount.
 * @param args - Bundled mediator, logger, page, baseUrl.
 * @param original - Failure returned by the first discovery pass.
 * @returns Post-reload discovery, or `original` when no crash detected.
 */
async function recoverFromClientCrash(
  args: IHomeRecoveryArgs,
  original: Procedure<IHomeDiscovery>,
): Promise<Procedure<IHomeDiscovery>> {
  const hasCrashed = await detectClientCrash(args.mediator);
  if (!hasCrashed) return original;
  return reloadAndRetry(args, original);
}

/**
 * Run HOME passive discovery, healing a client-side crash on failure.
 * Single PRE entry point: ordinary success and ordinary "no trigger"
 * failures pass straight through; only a detected crash boundary
 * triggers the reload-and-retry path.
 * @param args - Bundled mediator, logger, page, baseUrl.
 * @returns Discovery Procedure (recovered when a crash was healed).
 */
async function resolveHomeWithRecovery(
  args: IHomeRecoveryArgs,
): Promise<Procedure<IHomeDiscovery>> {
  const first = await resolveHomeStrategy(args.mediator, args.logger, args.page);
  if (first.success) return first;
  return recoverFromClientCrash(args, first);
}

/**
 * Assemble recovery args from a context whose mediator + browser page
 * the caller has already proven present (narrowed at the call site).
 * @param input - Pipeline context (source of logger + baseUrl).
 * @param mediator - Resolved element mediator.
 * @param page - Resolved browser page.
 * @returns Bundled recovery args.
 */
function toRecoveryArgs(
  input: IPipelineContext,
  mediator: IElementMediator,
  page: Page,
): IHomeRecoveryArgs {
  return { mediator, logger: input.logger, page, baseUrl: input.config.urls.base };
}

export type { IHomeRecoveryArgs };
export {
  CLIENT_CRASH_MARKERS,
  detectClientCrash,
  recoverFromClientCrash,
  resolveHomeWithRecovery,
  toRecoveryArgs,
};
