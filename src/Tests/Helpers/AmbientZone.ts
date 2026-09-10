import moment from 'moment-timezone';

/**
 * The two independent ambient-zone mechanisms a Node process carries.
 *
 * <p>`moment` is moment's own default zone; `env` is native `Date`'s. They are
 * genuinely separate: a renderer built on `new Date(y, m, d)` / `getFullYear()`
 * is invisible to the first and only the second catches it. Moving one alone
 * lets half the host-dependence in this codebase pass vacuously.
 */
export interface IAmbientZone {
  /** Moment's default zone, or `undefined` when none was ever set. */
  readonly moment: string | undefined;
  /** The raw `process.env.TZ`, or `undefined` when the host never set one. */
  readonly env: string | undefined;
}

/**
 * Read both ambient zones exactly as they stand, without substituting a
 * default for either.
 *
 * <p>Reading `process.env.TZ` through a `??` fallback is what makes a restore
 * lossy: an unset `TZ` (CI's normal state under `jest.pipeline.config.cjs`)
 * would be "restored" to a zone the host never had, leaking into every later
 * test in the same worker.
 * @returns The ambient zones currently in force.
 */
export function captureAmbientZone(): IAmbientZone {
  return { moment: moment().tz(), env: process.env.TZ };
}

/**
 * Put both ambient zones back exactly as {@link captureAmbientZone} found
 * them, including restoring `TZ` to *absent* when it started absent.
 * @param previous - The zones to reinstate.
 * @returns The zones that were reinstated.
 */
export function restoreAmbientZone(previous: IAmbientZone): IAmbientZone {
  moment.tz.setDefault(previous.moment);
  if (previous.env === undefined) delete process.env.TZ;
  else process.env.TZ = previous.env;
  return previous;
}

/**
 * Impersonate a host in `zone` for the duration of one probe, moving both
 * ambient mechanisms and restoring both afterwards.
 * @param zone - Ambient zone to impersonate.
 * @param run - Probe to evaluate.
 * @returns Whatever the probe returned.
 */
export function underZone<T>(zone: string, run: () => T): T {
  const previous = captureAmbientZone();
  moment.tz.setDefault(zone);
  process.env.TZ = zone;
  try {
    return run();
  } finally {
    restoreAmbientZone(previous);
  }
}
