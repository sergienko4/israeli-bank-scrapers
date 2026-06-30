/**
 * MAX bank — per-phase structural-invariant configuration.
 *
 * <p>Mirrors {@link ../Discount/DiscountPhaseConfig.ts},
 * {@link ../Hapoalim/HapoalimPhaseConfig.ts},
 * {@link ../Isracard/IsracardPhaseConfig.ts}, and
 * {@link ../Amex/AmexPhaseConfig.ts}. Markers are GENERIC
 * bank-identity substrings (no PII) that survive both real operator
 * harvests AND the synthetic stubs shipped here. The Mode A static
 * drive proves every fixture matches the marker contract the
 * production scraper's recipe + post-login waitFor relies on.
 *
 * <p>MAX is password-only (username + password — `MaxPipeline.ts`
 * declares no OTP leg). The captured journey diverges from
 * AMEX/Isracard because MAX's login lobby has a "Already registered /
 * Register" pre-step BEFORE the password form appears, so MAX's
 * `02-after-entry` and `03-after-private` are the PRE_LOGIN-equivalent
 * captured states (not AMEX-shape `02-pre-login` / `03-after-flip`).
 *
 * <p>MAX-distinct from Isracard/AMEX fixtures — the marker
 * `www.max.co.il` is unique to MAX (AMEX uses `americanexpress`,
 * Isracard uses `isracard`, Hapoalim uses `bankhapoalim`). A Mode A
 * regression accidentally pointing MAX at another bank's fixture root
 * would fail loudly, proving the per-bank cross-validation.
 */

/** Per-phase contract — what markers MUST appear in the captured HTML. */
interface IPhaseExpectation {
  readonly stepName: string;
  readonly mustContain: readonly string[];
}

/**
 * Generic bank-identity marker — present in every real MAX page
 * (URL `www.max.co.il`, canonical link, asset hosts) and in every
 * synthetic stub shipped here.
 *
 * <p>Empirical density on the captured harvests (commit `23f4750c`):
 * 99 / 99 / 69 / 70 occurrences in steps 01 / 02 / 03 / 04 respectively
 * — the marker is unambiguous and PII-free.
 *
 * <p>TODO (real-harvest milestone): once the operator harvests real
 * fixtures for the 5 post-login phases (07-auth-discovery onwards),
 * replace this single marker with phase-specific markers (e.g.
 * dashboard phase asserts `'transactionsDetails'` substring, scrape
 * phase asserts `'TransactionsAndGraphs'`) so the per-phase contract
 * carries richer structural meaning. Tracked under the same milestone
 * as Isracard's and AMEX's TODOs since all three share the harvest
 * pipeline.
 */
const MAX_BANK_MARKER = 'www.max.co.il';

/**
 * Ordered step names covered by Mode A static drive.
 *
 * <p>The 02 / 03 / 04 names reflect MAX's actual login journey
 * (pre-form lobby → privacy/registered toggle → reveal-password
 * form), NOT the AMEX-shape `02-pre-login` / `03-after-flip` naming
 * — operator's per-bank cross-validation rule explicitly forbids
 * reusing another bank's step names where the captured DOM state
 * differs. Step `10-scrape-transactions` is named after MAX's
 * `getTransactionsAndGraphs` endpoint (not Isracard's CurrentBilling
 * or AMEX's CardsTransactionsList) to surface the per-bank API
 * divergence in the fixture inventory.
 *
 * <p>SCRAPE / TERMINATE phases are exercised by Mode B SIMULATOR
 * (responses live under `responses/`), not Mode A.
 */
const PHASE_11_STEP_NAMES = [
  '01-home',
  '02-after-entry',
  '03-after-private',
  '04-reveal-password',
  '07-auth-discovery',
  '08-account-resolve',
  '09-dashboard',
  '10-scrape-transactions',
  '11-balance',
] as const;

/**
 * Ordered list of MAX phase expectations driven by Mode A.
 * Maps the production PHASE_CHAIN to the MAX phase HTML files
 * under `fixtures/banks/max/`. Built via `.map()` over the config
 * array — no duplication.
 */
const PHASE_EXPECTATIONS = PHASE_11_STEP_NAMES.map((stepName): IPhaseExpectation => ({
  stepName,
  mustContain: [MAX_BANK_MARKER],
}));

export { PHASE_EXPECTATIONS };
export type { IPhaseExpectation };
