/**
 * Landing-status evaluation for the INIT navigation.
 *
 * <p>Reads the status from the `Response` that `page.goto` already
 * returns. Deliberately listener-free: `Mediator/Init/PageObservers.ts`
 * exposes a landing-response collector, but it is gated OFF by default
 * because extra INIT-phase `page.on()` subscriptions added a
 * Marionette-wire dimension Camoufox cannot mask and Imperva escalated
 * Hapoalim's hCaptcha in response (see `InitForensicsGate.ts`). The
 * `goto` return value carries the same status at no fingerprint cost,
 * so this module never subscribes to anything.
 */

import type { Brand } from '../../Types/Brand.js';
import type { LandingStatus } from './LandingStatusConfig.js';
import { NO_LANDING_STATUS, TERMINAL_LANDING_STATUSES } from './LandingStatusConfig.js';

/** Whether a landing status asserts the document does not exist. */
type IsTerminalLanding = Brand<boolean, 'IsTerminalLanding'>;

/** PII-safe INIT failure message naming a terminal landing status. */
type LandingFailureText = Brand<string, 'LandingFailureText'>;

/**
 * Invoke a response's `status()` and normalise whatever comes back.
 *
 * <p>A driver method is not obliged to be total. Playwright can throw
 * when the underlying channel is already disposed, and this runs on the
 * INIT success path for every bank, so an escaping throw would be caught
 * by the navigation handler and reported as "navigation failed" — the
 * phantom failure this module exists to remove. A throw and a
 * non-numeric answer are equally unusable, so both read as the sentinel.
 *
 * @param status - Bound `status` method from the candidate response.
 * @returns The reported status, or {@link NO_LANDING_STATUS}.
 */
function callStatus(status: () => unknown): LandingStatus {
  try {
    const reported: unknown = status();
    return typeof reported === 'number' ? (reported as LandingStatus) : NO_LANDING_STATUS;
  } catch {
    return NO_LANDING_STATUS;
  }
}

/**
 * Read the HTTP status of the committed landing document.
 *
 * <p>Takes `unknown` deliberately. This runs on the critical path of
 * every bank's INIT, and a throw here would be caught by the navigation
 * handler and reported as "navigation failed" — turning a healthy
 * landing into a phantom failure, the very class of silent breakage this
 * module exists to remove. The repo already carries
 * `scripts/patch-playwright-core.mjs` because playwright-core 1.62.1
 * throws on an unguarded driver field, so the risk is not theoretical.
 * Typing the input as `unknown` keeps the guard honest instead of
 * asserting a shape the driver is not obliged to honour.
 *
 * @param response - Whatever `page.goto` resolved with.
 * @returns The status, or {@link NO_LANDING_STATUS} when unavailable.
 */
export function readLandingStatus(response: unknown): LandingStatus {
  if (response === null || typeof response !== 'object') return NO_LANDING_STATUS;
  const candidate = response as { status?: () => unknown };
  if (typeof candidate.status !== 'function') return NO_LANDING_STATUS;
  const boundStatus = candidate.status.bind(response);
  return callStatus(boundStatus);
}

/**
 * Report whether a landing status asserts the document does not exist.
 *
 * @param status - Status from {@link readLandingStatus}.
 * @returns `true` when no later phase can recover from this landing.
 */
export function isTerminalLandingStatus(status: number): IsTerminalLanding {
  return TERMINAL_LANDING_STATUSES.has(status) as IsTerminalLanding;
}

/**
 * Build the INIT failure message for a terminal landing status.
 *
 * <p>Names the status so the log attributes the run to the bank's edge
 * rather than to scrape logic — the distinction that previously cost a
 * forensic-bundle download to establish.
 *
 * @param status - Terminal status from {@link isTerminalLandingStatus}.
 * @param maskedUrl - Target URL, already PII-masked by the caller.
 * @returns Human-readable, PII-safe failure message.
 */
export function landingFailureMessage(status: number, maskedUrl: string): LandingFailureText {
  return (`INIT ACTION: bank edge served HTTP ${String(status)} for the landing ` +
    `document (${maskedUrl}); no later phase can recover from it`) as LandingFailureText;
}
