/**
 * Cross-cutting timing primitives — shared across every phase and not
 * owned by any single phase folder. Split out of the TimingConfig
 * barrel during Phase 12b (KG-driven decoupling of the 481-LoC config
 * hub).
 *
 * <p>Conventions and rationale for each constant are preserved from
 * the original file; the only change is physical location. The barrel
 * was retired once every importer moved to a domain file, so this is
 * now the canonical definition for these constants.
 */

/** One second in milliseconds — base unit for timeout arithmetic. */
export const SECOND = 1000;

/** Default lower bound of `humanDelay` (ms). */
export const HUMAN_DELAY_MIN_MS = 300;

/** Default upper bound of `humanDelay` (ms). */
export const HUMAN_DELAY_MAX_MS = 1200;
