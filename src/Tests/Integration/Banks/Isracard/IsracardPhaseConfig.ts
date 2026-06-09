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
 * Generic bank-identity marker — present in every real Isracard page
 * (URL, scripts, branding) and in every synthetic stub shipped here.
 *
 * <p>TODO (real-harvest milestone): once the operator harvests real
 * fixtures for the 7 post-login phases, replace this single marker
 * with phase-specific markers (e.g. dashboard phase asserts
 * `'NewAccountTransactions'`, scrape phase asserts `'CurrentBillingDate'`)
 * so the per-phase contract carries richer structural meaning.
 */
const ISRACARD_BANK_MARKER = 'isracard';

/**
 * Ordered step names covered by Mode A static drive.
 *
 * <p>Includes `03-after-flip` (the captured form-flipped lobby state)
 * so the same fixture validated by LoginFormDiscovery integration tests
 * is also covered by the Phase-11 marker contract — keeping
 * {@link ISRACARD_PHASE_11_STEPS} in `BankFixtureExpectations.ts` and
 * {@link PHASE_EXPECTATIONS} here in lock-step.
 *
 * <p>SCRAPE / TERMINATE phases are exercised by Mode B SIMULATOR
 * (responses live under `responses/`), not Mode A.
 */
const PHASE_11_STEP_NAMES = [
  '01-home',
  '02-pre-login',
  '03-after-flip',
  '04-login-action',
  '07-auth-discovery',
  '08-account-resolve',
  '09-dashboard',
  '10-scrape-cycle-billing',
  '11-balance',
] as const;

/**
 * Ordered list of Isracard phase expectations driven by Mode A.
 * Maps the production PHASE_CHAIN to the harvested phase HTML files
 * under `fixtures/banks/isracard/`.
 */
const PHASE_EXPECTATIONS = PHASE_11_STEP_NAMES.map(
  (stepName): IPhaseExpectation => ({
    stepName,
    mustContain: [ISRACARD_BANK_MARKER],
  }),
);

export { PHASE_EXPECTATIONS };
export type { IPhaseExpectation };
