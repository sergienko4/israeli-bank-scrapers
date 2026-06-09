/**
 * Discount bank — per-phase structural-invariant configuration.
 *
 * <p>Extracted from {@link ../../Banks/Discount/Discount.modeA.test.ts}
 * per PR-321 cycle-1 CR finding #6: keep test bodies declarative and
 * make the phase contract reusable / inspectable without importing
 * the Jest test module.
 */

/** Per-phase contract — what markers MUST appear in the captured HTML. */
interface IPhaseExpectation {
  readonly stepName: string;
  readonly mustContain: readonly string[];
}

/**
 * Ordered list of Discount phase expectations driven by Mode A.
 * Mirrors the production scraper PHASE_CHAIN (01-home → 11-balance).
 */
const PHASE_EXPECTATIONS = [
  { stepName: '01-home', mustContain: ['discountbank.co.il'] },
  { stepName: '02-pre-login', mustContain: ['tzId', 'aidnum'] },
  { stepName: '04-login-action', mustContain: ['telebank'] },
  { stepName: '07-auth-discovery', mustContain: ['telebank'] },
  { stepName: '08-account-resolve', mustContain: ['telebank'] },
  { stepName: '09-dashboard', mustContain: ['telebank'] },
  { stepName: '10-scrape-transactions', mustContain: ['telebank'] },
  { stepName: '11-balance', mustContain: ['telebank'] },
] as const satisfies readonly IPhaseExpectation[];

export { PHASE_EXPECTATIONS };
export type { IPhaseExpectation };
