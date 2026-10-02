/**
 * PepperDurableHarness — opt-in real-E2E driver for Pepper's durable
 * (persistent-auth) mode.
 *
 * On/off flags — any non-empty value turns one on; unset or empty is off:
 *   PEPPER_PERSISTENT_AUTH               durable mode; state is cached in
 *                                        `<tmpdir>/pepper-durable.cache`
 *   PEPPER_PERSISTENT_AUTH_ENROLL        explicit enrollment: one SMS, state out
 *   PEPPER_PERSISTENT_AUTH_FORCE_EXPIRY  resume with the cached state's access
 *                                        token swapped, in memory only, for an
 *                                        expired synthetic JWT
 *
 * Without ENROLL a durable run needs an existing state and fails before any
 * scrape when it is missing: it never enrolls implicitly, never falls back to
 * a cold login, and the cache changes only through the scraper's callback.
 */

import ScraperError from '../../Scrapers/Base/ScraperError.js';
import type { ScraperLogger } from '../../Scrapers/Pipeline/Logging/Debug.js';
import { forceExpiry, type ResumeOutcome, resumeOutcomeOf } from './PepperDurableState.js';
import { createTokenCache, type ITokenCacheHandle } from './TokenCache.js';

/** Durable flags, by role. */
const DURABLE_FLAGS = {
  enable: 'PEPPER_PERSISTENT_AUTH',
  enroll: 'PEPPER_PERSISTENT_AUTH_ENROLL',
  forceExpiry: 'PEPPER_PERSISTENT_AUTH_FORCE_EXPIRY',
} as const;

/** Which durable run the flags select. */
type DurableRunKind = 'off' | 'enroll' | 'resume' | 'resume-expired';

/** What a durable run may cost and must publish. */
interface IDurableAllowance {
  readonly maxOtp: number;
  readonly publications: number;
}

/** Enrollment may spend its one SMS; resume never spends one. */
const ENROLL_ALLOWANCE: IDurableAllowance = { maxOtp: 1, publications: 1 };

/** A replay publishes nothing; a renewal publishes the replacement state. */
const RESUME_ALLOWANCE: Readonly<Record<ResumeOutcome, IDurableAllowance>> = {
  replay: { maxOtp: 0, publications: 0 },
  renew: { maxOtp: 0, publications: 1 },
};

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
 * Select the durable run the flags describe.
 * @param env - Environment to read.
 * @returns Run kind; `off` leaves the legacy suite in charge.
 */
function durableRunKindOf(env: NodeJS.ProcessEnv): DurableRunKind {
  if (!isFlagSet(env, DURABLE_FLAGS.enable)) return 'off';
  const isEnroll = isFlagSet(env, DURABLE_FLAGS.enroll);
  const isForced = isFlagSet(env, DURABLE_FLAGS.forceExpiry);
  if (isEnroll && isForced) throw new ScraperError('choose enrollment or forced expiry, not both');
  if (isEnroll) return 'enroll';
  return isForced ? 'resume-expired' : 'resume';
}

/**
 * Durable-state cache: same atomic `0600` writer as the token cache, separate file.
 * @param log - Logger for cache diagnostics.
 * @param dir - Optional cache directory (tests).
 * @returns Cache handle, enabled only when durable mode is.
 */
function createDurableCache(log: ScraperLogger, dir?: string): ITokenCacheHandle {
  const base = { bankKey: 'pepper', envFlag: DURABLE_FLAGS.enable, log, dir } as const;
  return createTokenCache({ ...base, artifact: 'durable' });
}

/**
 * State sink for `onPersistentAuthStateUpdate`: throws when the state was not
 * persisted, so the scraper withholds a bearer the next run could not resume.
 * @param cache - Durable-state cache.
 * @param onStored - Called after each successful write (run evidence).
 * @returns Callback.
 */
function buildDurableSink(
  cache: ITokenCacheHandle,
  onStored: () => unknown,
): (state: string) => Promise<void> {
  return async (state: string): Promise<void> => {
    const isWritten = await cache.write(state);
    if (!isWritten) throw new ScraperError('durable state was not persisted');
    onStored();
  };
}

/**
 * Read the cached state, refusing before any scrape when there is none.
 * @param cache - Durable-state cache.
 * @returns Stored state.
 */
async function requireStoredState(cache: ITokenCacheHandle): Promise<string> {
  const stored = await cache.read();
  if (stored.length > 0) return stored;
  throw new ScraperError(`no durable state cached; enroll with ${DURABLE_FLAGS.enroll}=1`);
}

/** Scraper-option fragment carrying the state to resume from, if any. */
interface IDurableStateOption {
  readonly persistentAuthState?: string;
}

/** What one durable run hands the scraper and what it may cost. */
interface IDurableRunPlan {
  readonly stateOption: IDurableStateOption;
  readonly allowance: IDurableAllowance;
}

/**
 * Plan a durable run. Enrollment never reads the cache; a forced expiry
 * resumes from an in-memory copy; a plain resume is classified up front.
 * @param kind - Durable run kind (not `off`).
 * @param cache - Durable-state cache.
 * @param phoneNumber - Raw phone credential.
 * @returns State option plus the run's allowance.
 */
async function planDurableRun(
  kind: Exclude<DurableRunKind, 'off'>,
  cache: ITokenCacheHandle,
  phoneNumber: string,
): Promise<IDurableRunPlan> {
  if (kind === 'enroll') return { stateOption: {}, allowance: ENROLL_ALLOWANCE };
  const stored = await requireStoredState(cache);
  if (kind === 'resume') {
    const outcome = resumeOutcomeOf(stored, phoneNumber);
    return { stateOption: { persistentAuthState: stored }, allowance: RESUME_ALLOWANCE[outcome] };
  }
  const forced = forceExpiry(stored, phoneNumber);
  return { stateOption: { persistentAuthState: forced }, allowance: RESUME_ALLOWANCE.renew };
}

export type { DurableRunKind, IDurableAllowance, IDurableRunPlan, IDurableStateOption };
export {
  buildDurableSink,
  createDurableCache,
  DURABLE_FLAGS,
  durableRunKindOf,
  ENROLL_ALLOWANCE,
  planDurableRun,
  requireStoredState,
  RESUME_ALLOWANCE,
};
