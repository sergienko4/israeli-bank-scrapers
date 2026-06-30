/**
 * AMEX bank — per-phase structural-invariant configuration.
 *
 * <p>Mirrors {@link ../Discount/DiscountPhaseConfig.ts},
 * {@link ../Hapoalim/HapoalimPhaseConfig.ts}, and
 * {@link ../Isracard/IsracardPhaseConfig.ts}. Markers are GENERIC
 * bank-identity substrings (no PII) that survive both real operator
 * harvests AND the synthetic stubs shipped here. The Mode A static
 * drive proves every fixture matches the marker contract the
 * production scraper's recipe + post-login waitFor relies on.
 *
 * <p>AMEX is password-only (id + password + card6Digits) with no OTP
 * leg, mirroring Isracard's same-shape login lobby (both use the
 * `otpLobbyForm*` family) but the post-login surface diverges:
 * AMEX is card-centric (DashboardMonth → CardsTransactionsList)
 * while Isracard is account-centric (GetCardList → UserAccountsData).
 *
 * <p>Synthetic stubs are AMEX-distinct from Isracard's — the marker
 * `americanexpress` is unique to AMEX fixtures, so a Mode A regression
 * accidentally pointing AMEX at Isracard's fixture root would fail
 * loudly, proving the per-bank cross-validation.
 */

/** Per-phase contract — what markers MUST appear in the captured HTML. */
interface IPhaseExpectation {
  readonly stepName: string;
  readonly mustContain: readonly string[];
}

/**
 * Generic bank-identity marker — present in every real AMEX page
 * (URL `he.americanexpress.co.il`, brand text, asset hosts) and in
 * every synthetic stub shipped here.
 *
 * <p>TODO (real-harvest milestone): once the operator harvests real
 * fixtures for the 7 post-login phases, replace this single marker
 * with phase-specific markers (e.g. dashboard phase asserts
 * `'dashboard'` substring, scrape phase asserts
 * `'CardsTransactionsList'`) so the per-phase contract carries
 * richer structural meaning. Tracked under the same milestone as
 * Isracard's TODO since both share the harvest pipeline.
 */
const AMEX_BANK_MARKER = 'americanexpress';

/**
 * Ordered step names covered by Mode A static drive.
 *
 * <p>Includes `03-after-flip` (the captured form-flipped lobby state)
 * so the same fixture validated by LoginFormDiscovery integration tests
 * is also covered by the Phase-11 marker contract. Step `10-scrape-transactions`
 * is named after AMEX's CardsTransactionsList endpoint (not Isracard's
 * CurrentBillingDate) to surface the per-bank API divergence in the
 * fixture inventory.
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
  '10-scrape-transactions',
  '11-balance',
] as const;

/**
 * Ordered list of AMEX phase expectations driven by Mode A.
 * Maps the production PHASE_CHAIN to the AMEX phase HTML files
 * under `fixtures/banks/amex/`. Built via `.map()` over the config
 * array — no duplication.
 */
const PHASE_EXPECTATIONS = PHASE_11_STEP_NAMES.map((stepName): IPhaseExpectation => ({
  stepName,
  mustContain: [AMEX_BANK_MARKER],
}));

export { PHASE_EXPECTATIONS };
export type { IPhaseExpectation };
