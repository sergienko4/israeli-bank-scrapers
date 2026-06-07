/**
 * Canonical 11-phase enum for cross-bank integration coverage matrix.
 *
 * Source of truth: `C:\tmp\guidelines\general-phases-view-guidlines.md`
 * defines the production scraper PHASE_CHAIN:
 * `INIT -> HOME -> PRE_LOGIN -> LOGIN -> OTP_TRIGGER -> OTP_FILL ->
 * AUTH_DISCOVERY -> ACCOUNT_RESOLVE -> DASHBOARD -> SCRAPE -> TERMINATE`.
 *
 * Decoupled from fixture filename prefixes (e.g. `04-login-action.html`)
 * so the coverage matrix, mirror manifest, and drive tests reason against a
 * stable enum value rather than a brittle filename convention.
 *
 * A bank/phase cell that the bank genuinely does not exercise (e.g. Isracard
 * has no separate OTP_TRIGGER step) is marked `n/a` with justification
 * in the per-bank phase matrix — never silently skipped.
 *
 * @see C:\tmp\guidelines\general-phases-view-guidlines.md
 */

import { none, type Option, some } from '../../../Scrapers/Pipeline/Types/Option.js';

/** All eleven canonical phases the scraper progresses through. */
const INTEGRATION_PHASES = [
  'INIT',
  'HOME',
  'PRE_LOGIN',
  'LOGIN',
  'OTP_TRIGGER',
  'OTP_FILL',
  'AUTH_DISCOVERY',
  'ACCOUNT_RESOLVE',
  'DASHBOARD',
  'SCRAPE',
  'TERMINATE',
] as const;

/** Union of canonical phase names — drives manifest, matrix, and drive APIs. */
type IntegrationPhase = (typeof INTEGRATION_PHASES)[number];

/**
 * Returns the canonical phase enum value when `value` matches one of
 * the eleven phase names, wrapped as `Option<IntegrationPhase>`.
 *
 * @param value - Candidate string from manifest/matrix/file.
 * @returns Some(phase) on match, None otherwise.
 */
function asIntegrationPhase(value: string): Option<IntegrationPhase> {
  for (const phase of INTEGRATION_PHASES) {
    if (phase === value) return some(phase);
  }
  return none();
}

/**
 * Returns the ordinal of a phase in the canonical chain (0 = INIT,
 * 10 = TERMINATE). Used by the mirror simulator to enforce forward-only
 * phase advancement and by the coverage matrix to render in pipeline order.
 *
 * @param phase - The canonical phase value.
 * @returns Zero-based ordinal in the PHASE_CHAIN.
 */
function phaseOrdinal(phase: IntegrationPhase): number {
  return INTEGRATION_PHASES.indexOf(phase);
}

/**
 * Returns true when `candidate` comes strictly AFTER `current`
 * in the canonical chain. Used to reject backward state-machine transitions
 * in the mirror simulator.
 *
 * @param current - The phase the simulator is currently in.
 * @param candidate - The phase a transition predicate proposes to advance to.
 * @returns True when forward, false when same/backward.
 */
function isForwardTransition(current: IntegrationPhase, candidate: IntegrationPhase): boolean {
  return phaseOrdinal(candidate) > phaseOrdinal(current);
}

export type { IntegrationPhase };
export { asIntegrationPhase, INTEGRATION_PHASES, isForwardTransition, phaseOrdinal };
