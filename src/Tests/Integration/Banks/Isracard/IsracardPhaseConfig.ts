/**
 * Isracard bank — per-phase structural-invariant configuration.
 *
 * <p>Mirrors {@link ../Discount/DiscountPhaseConfig.ts} and
 * {@link ../Hapoalim/HapoalimPhaseConfig.ts}. Markers are GENERIC
 * bank-identity substrings (no PII) that survive both real operator
 * harvests AND the synthetic stubs shipped here. The Mode A static
 * drive proves every fixture matches the marker contract the
 * production scraper's recipe + post-login waitFor relies on.
 *
 * <p>Isracard is password-only (no OTP) and runs as a same-URL SPA
 * after login — `AuthDiscoveryInterstitial.ts` documents the
 * `/StatusPage` same-URL gate. The post-login HTMLs all live under
 * `digital.isracard.co.il/personalarea/...` even though the visible
 * SPA route changes from `/Login/` to `/NewAccountTransactions/`.
 */

/** Per-phase contract — what markers MUST appear in the captured HTML. */
interface IPhaseExpectation {
  readonly stepName: string;
  readonly mustContain: readonly string[];
}

/**
 * Ordered list of Isracard phase expectations driven by Mode A.
 * Maps the production PHASE_CHAIN to the harvested phase HTML files
 * under `fixtures/banks/isracard/`. SCRAPE / TERMINATE are exercised
 * by Mode B SIMULATOR (responses live under `responses/`).
 */
const PHASE_EXPECTATIONS = [
  { stepName: '01-home', mustContain: ['isracard'] },
  { stepName: '02-pre-login', mustContain: ['isracard'] },
  { stepName: '04-login-action', mustContain: ['isracard'] },
  { stepName: '07-auth-discovery', mustContain: ['isracard'] },
  { stepName: '08-account-resolve', mustContain: ['isracard'] },
  { stepName: '09-dashboard', mustContain: ['isracard'] },
  { stepName: '10-scrape-cycle-billing', mustContain: ['isracard'] },
  { stepName: '11-balance', mustContain: ['isracard'] },
] as const satisfies readonly IPhaseExpectation[];

export { PHASE_EXPECTATIONS };
export type { IPhaseExpectation };
