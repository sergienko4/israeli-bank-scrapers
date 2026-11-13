/**
 * HapoalimWarmHarness — opt-in real-E2E driver for Hapoalim's cookie-jar
 * warm start.
 *
 * <p>A run that signs in returns its session as a `v1.` jar token, bound to
 * the user code. Passed back as `otpLongTermToken`, it lets the next run start
 * at the landing step and skip the login and the SMS. Flags are on/off by
 * presence — any nonempty value turns one on:
 *
 * <ul>
 *   <li>`HAPOALIM_OTP_LONG_TERM` — cache the token in
 *       `<tmpdir>/hapoalim-token.cache`;</li>
 *   <li>`HAPOALIM_WARM_ENROLL` — enroll: one cold login, at most one SMS, and
 *       the token is cached;</li>
 *   <li>`HAPOALIM_OTP_TIMEOUT_MS` — optional wait budget for an interactive
 *       code, applied to both the poller and the pipeline's OTP guard.</li>
 * </ul>
 *
 * <p>Without `ENROLL` the run is a resume. It refuses before any request when
 * no token is cached: it never enrolls implicitly, and the suite itself never
 * falls back to a cold login. A resume may spend zero SMS messages.
 */

import ScraperError from '../../Scrapers/Base/ScraperError.js';
import type { ScraperLogger } from '../../Scrapers/Pipeline/Logging/Debug.js';
import { DEFAULT_OTP_TIMEOUT_MS } from '../../Scrapers/Pipeline/Mediator/Timing/OtpTimingConfig.js';
import { createTokenCache, type ITokenCacheHandle } from './TokenCache.js';

/** Warm-start flags, by role. */
const HAPOALIM_WARM_FLAGS = {
  cache: 'HAPOALIM_OTP_LONG_TERM',
  enroll: 'HAPOALIM_WARM_ENROLL',
  otpTimeout: 'HAPOALIM_OTP_TIMEOUT_MS',
} as const;

/** Which warm run the flags select. */
type HapoalimWarmRunKind = 'off' | 'enroll' | 'resume';

/** What a warm run may cost. */
interface IWarmAllowance {
  /** Messages the run may send. */
  readonly maxOtp: number;
}

/** Enrollment may spend its one SMS; a resume must spend none. */
const ENROLL_ALLOWANCE: IWarmAllowance = { maxOtp: 1 };

/** A resume replays a live session, so it must never text the user. */
const RESUME_ALLOWANCE: IWarmAllowance = { maxOtp: 0 };

/**
 * Whether an on/off flag is on.
 * @param env - Environment to read.
 * @param name - Flag name.
 * @returns True when the flag is nonempty.
 */
function isFlagSet(env: NodeJS.ProcessEnv, name: string): boolean {
  const value = env[name];
  return value !== undefined && value.length > 0;
}

/**
 * Select the warm run the flags describe.
 * @param env - Environment to read.
 * @returns Run kind; `off` leaves the cold suite in charge.
 */
function hapoalimWarmRunKindOf(env: NodeJS.ProcessEnv): HapoalimWarmRunKind {
  if (!isFlagSet(env, HAPOALIM_WARM_FLAGS.cache)) return 'off';
  return isFlagSet(env, HAPOALIM_WARM_FLAGS.enroll) ? 'enroll' : 'resume';
}

/**
 * Resolve the OTP wait budget. The pipeline reads the same value from the
 * credentials, so a wider poller window never outlives the phase's own guard.
 * @param env - Environment to read.
 * @returns Positive millisecond budget; the pipeline default when unset.
 * @throws ScraperError when the flag is set to anything but a positive integer.
 */
function resolveOtpTimeoutMs(env: NodeJS.ProcessEnv): number {
  const raw = env[HAPOALIM_WARM_FLAGS.otpTimeout];
  if (raw === undefined || raw.length === 0) return DEFAULT_OTP_TIMEOUT_MS;
  const ms = Number(raw);
  if (Number.isSafeInteger(ms) && ms > 0) return ms;
  throw new ScraperError(`${HAPOALIM_WARM_FLAGS.otpTimeout} must be a positive integer`);
}

/**
 * Token cache for the warm start: the same atomic `0600` writer as every bank.
 * @param log - Logger for cache diagnostics.
 * @param dir - Optional cache directory (tests).
 * @returns Cache handle, enabled only when the warm flag is on.
 */
function createHapoalimWarmCache(log: ScraperLogger, dir?: string): ITokenCacheHandle {
  const base = { bankKey: 'hapoalim', envFlag: HAPOALIM_WARM_FLAGS.cache, log, dir } as const;
  return createTokenCache(base);
}

/**
 * Read the cached token, refusing before any scrape when there is none.
 * @param cache - Warm token cache.
 * @returns Stored token.
 * @throws ScraperError naming the enrollment flag when the cache is empty.
 */
async function requireStoredToken(cache: ITokenCacheHandle): Promise<string> {
  const stored = await cache.read();
  if (stored.length > 0) return stored;
  throw new ScraperError(`no warm token cached; enroll with ${HAPOALIM_WARM_FLAGS.enroll}=1`);
}

/** What one warm run hands the scraper and what it may cost. */
interface IHapoalimWarmPlan {
  /** Token to pass as `otpLongTermToken`; '' forces a cold login. */
  readonly token: string;
  /** Messages the run may send. */
  readonly allowance: IWarmAllowance;
}

/**
 * Plan a warm run. Enrollment never reads the cache; a resume needs one.
 * @param kind - Warm run kind (not `off`).
 * @param cache - Warm token cache.
 * @returns Token plus the run's allowance.
 */
async function planHapoalimWarmRun(
  kind: Exclude<HapoalimWarmRunKind, 'off'>,
  cache: ITokenCacheHandle,
): Promise<IHapoalimWarmPlan> {
  if (kind === 'enroll') return { token: '', allowance: ENROLL_ALLOWANCE };
  return { token: await requireStoredToken(cache), allowance: RESUME_ALLOWANCE };
}

export type { HapoalimWarmRunKind, IHapoalimWarmPlan, IWarmAllowance };
export {
  createHapoalimWarmCache,
  ENROLL_ALLOWANCE,
  HAPOALIM_WARM_FLAGS,
  hapoalimWarmRunKindOf,
  planHapoalimWarmRun,
  requireStoredToken,
  resolveOtpTimeoutMs,
  RESUME_ALLOWANCE,
};
