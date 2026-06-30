/**
 * VisaCal bank — per-phase structural-invariant configuration.
 *
 * <p>Mirrors {@link ../Discount/DiscountPhaseConfig.ts},
 * {@link ../Hapoalim/HapoalimPhaseConfig.ts},
 * {@link ../Isracard/IsracardPhaseConfig.ts},
 * {@link ../Amex/AmexPhaseConfig.ts}, and
 * {@link ../Max/MaxPhaseConfig.ts}. Markers are GENERIC bank-identity
 * substrings (no PII) that survive both real operator harvests AND
 * the synthetic stubs shipped here. The Mode A static drive proves
 * every fixture matches the marker contract the production scraper's
 * recipe + post-login waitFor relies on.
 *
 * <p>VisaCal is password-only (username + password — `VisaCalPipeline.ts`
 * declares no OTP leg). VisaCal is currently flagged
 * `requiresHydration: true` in {@link ../BankFixtureExpectations.ts}
 * because the captured `02-pre-login.html` is missing the SPA-hydrated
 * `<input type=password>` (harvester recipe gap tracked in
 * `.github/banks-pending-reharvest.txt`). Mode A marker checks +
 * Mode B SIMULATOR state-machine are orthogonal to that harvester
 * gap — they validate fixture identity + URL routing, not the live
 * SPA login interaction.
 *
 * <p>VisaCal-distinct from MAX/Isracard/AMEX fixtures — the marker
 * `cal-online.co.il` is unique to VisaCal (MAX uses `www.max.co.il`,
 * AMEX uses `americanexpress`, Isracard uses `isracard`, Hapoalim
 * uses `bankhapoalim`). A Mode A regression accidentally pointing
 * VisaCal at another bank's fixture root would fail loudly, proving
 * the per-bank cross-validation.
 */

/** Per-phase contract — what markers MUST appear in the captured HTML. */
interface IPhaseExpectation {
  readonly stepName: string;
  readonly mustContain: readonly string[];
}

/**
 * Generic bank-identity marker — present in every real VisaCal page
 * (top-level domain `cal-online.co.il`, asset hosts
 * `css.cal-online.co.il` / `accessability.cal-online.co.il`, canonical
 * links, API host `api.cal-online.co.il`) and in every synthetic stub
 * shipped here.
 *
 * <p>Empirical density on the captured harvests (commit `95862616`):
 * appears 100+ times in `01-home.html` (358 KB) and `02-pre-login.html`
 * (264 KB) — the marker is unambiguous and PII-free.
 *
 * <p>TODO (real-harvest milestone): once the operator harvests real
 * fixtures for the 7 post-login phases (03-after-username onwards),
 * replace this single marker with phase-specific markers (e.g. auth
 * phase asserts `'col-rest/calconnect/authentication'`, dashboard
 * phase asserts `'CalOnlineMetadata.API'`, scrape phase asserts
 * `'getCardTransactionsDetails'`) so the per-phase contract carries
 * richer structural meaning. Tracked under the same milestone as
 * Isracard/AMEX/MAX TODOs.
 */
const VISACAL_BANK_MARKER = 'cal-online.co.il';

/**
 * Ordered step names covered by Mode A static drive.
 *
 * <p>The 03 / 04 step names reflect VisaCal's password-only login
 * journey (username entry → password reveal), NOT the AMEX-shape
 * `02-pre-login` / `03-after-flip` / `04-login-action` SMS-toggle
 * naming — operator's per-bank cross-validation rule explicitly
 * forbids reusing another bank's step names where the captured DOM
 * state differs. Step `10-scrape-transactions` is named after
 * VisaCal's `getCardTransactionsDetails` endpoint (not Isracard's
 * CurrentBilling or AMEX's CardsTransactionsList or MAX's
 * TransactionsAndGraphs) to surface the per-bank API divergence in
 * the fixture inventory.
 *
 * <p>SCRAPE / TERMINATE phases are exercised by Mode B SIMULATOR
 * (responses live under `responses/`), not Mode A.
 */
const PHASE_11_STEP_NAMES = [
  '01-home',
  '02-pre-login',
  '03-after-username',
  '04-password-entered',
  '07-auth-discovery',
  '08-account-resolve',
  '09-dashboard',
  '10-scrape-transactions',
  '11-balance',
] as const;

/**
 * Ordered list of VisaCal phase expectations driven by Mode A.
 * Maps the production PHASE_CHAIN to the VisaCal phase HTML files
 * under `fixtures/banks/visaCal/`. Built via `.map()` over the
 * config array — no duplication.
 */
const PHASE_EXPECTATIONS = PHASE_11_STEP_NAMES.map((stepName): IPhaseExpectation => ({
  stepName,
  mustContain: [VISACAL_BANK_MARKER],
}));

export { PHASE_EXPECTATIONS };
export type { IPhaseExpectation };
