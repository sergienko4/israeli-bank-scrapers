/**
 * Hapoalim bank — per-phase structural-invariant configuration.
 *
 * <p>Mirrors {@link ../Discount/DiscountPhaseConfig.ts}; see Phase 11
 * cycle docs in plan.md. Each entry describes the canonical phase step
 * and the marker substrings that MUST appear in the captured HTML so
 * the Mode A static drive proves the fixture matches the contract the
 * production scraper relies on.
 */

/** Per-phase contract — what markers MUST appear in the captured HTML. */
interface IPhaseExpectation {
  readonly stepName: string;
  readonly mustContain: readonly string[];
}

/**
 * Ordered list of Hapoalim phase expectations driven by Mode A.
 * Maps the production PHASE_CHAIN (INIT → ... → DASHBOARD) to the
 * harvested phase HTML files under
 * `fixtures/banks/hapoalim/`. SCRAPE / TERMINATE are exercised by
 * Mode B SIMULATOR (responses live under `responses/`).
 */
const PHASE_EXPECTATIONS = [
  { stepName: '01-home', mustContain: ['bankhapoalim'] },
  { stepName: '02-pre-login', mustContain: ['password'] },
  { stepName: '04-login-action', mustContain: ['login.bankhapoalim', 'rb/he'] },
  { stepName: '07-auth-discovery', mustContain: ['homepage'] },
  { stepName: '08-account-resolve', mustContain: ['ServerServices'] },
  { stepName: '09-dashboard', mustContain: ['homepage'] },
] as const satisfies readonly IPhaseExpectation[];

export { PHASE_EXPECTATIONS };
export type { IPhaseExpectation };
