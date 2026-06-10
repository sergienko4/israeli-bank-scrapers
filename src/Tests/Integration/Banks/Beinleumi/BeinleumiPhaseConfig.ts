/**
 * Beinleumi bank — per-phase structural-invariant configuration.
 *
 * <p>Mirrors {@link ../Discount/DiscountPhaseConfig.ts},
 * {@link ../Hapoalim/HapoalimPhaseConfig.ts},
 * {@link ../Isracard/IsracardPhaseConfig.ts},
 * {@link ../Amex/AmexPhaseConfig.ts},
 * {@link ../Max/MaxPhaseConfig.ts}, and
 * {@link ../VisaCal/VisaCalPhaseConfig.ts}. Markers are GENERIC bank-identity
 * substrings (no PII) that survive both real operator harvests AND
 * the synthetic stubs shipped here. The Mode A static drive proves
 * every fixture matches the marker contract the production scraper's
 * recipe + post-login waitFor relies on.
 *
 * <p>Beinleumi (FIBI) is OTP-gated — `BeinleumiPipeline.ts` declares
 * `.withOtpTrigger().withOtpFill()` so the canonical chain includes
 * explicit OTP_TRIGGER + OTP_FILL phases (unlike Hapoalim's Mode B
 * which COLLAPSES OTP into a single LOGIN→AUTH_DISCOVERY transition).
 * Beinleumi is the FIRST bank in the Phase-11 series to exercise the
 * simulator's `integ_otp_challenge` nonce-binding contract
 * (see {@link ../../Mirror/MirrorOtpChallenge.ts}). Beinleumi is
 * currently flagged `requiresHydration: true` in
 * {@link ../BankFixtureExpectations.ts} because the captured lobby
 * HTML renders the credential form inside an Angular-driven iframe
 * post-JS (harvester recipe gap tracked in
 * `.github/banks-pending-reharvest.txt`). Mode A marker checks +
 * Mode B SIMULATOR state-machine are orthogonal to that harvester
 * gap — they validate fixture identity + URL routing + OTP nonce
 * round-trip, not the live SPA login interaction.
 *
 * <p>Beinleumi-distinct from MAX / Isracard / AMEX / VisaCal / Hapoalim
 * fixtures — the marker `fibi.co.il` is unique to Beinleumi (MAX uses
 * `www.max.co.il`, AMEX uses `americanexpress`, Isracard uses
 * `isracard`, Hapoalim uses `bankhapoalim`, VisaCal uses
 * `cal-online.co.il`). A Mode A regression accidentally pointing
 * Beinleumi at another bank's fixture root would fail loudly,
 * proving the per-bank cross-validation.
 */

/** Per-phase contract — what markers MUST appear in the captured HTML. */
interface IPhaseExpectation {
  readonly stepName: string;
  readonly mustContain: readonly string[];
}

/**
 * Generic bank-identity marker — present in every real Beinleumi page
 * (top-level marketing domain `www.fibi.co.il`, auth/BFF host
 * `online.fibi.co.il`, asset hosts, canonical links) and baked into
 * every synthetic stub shipped here.
 *
 * <p>Empirical density on the captured harvests (commit `74bc733e`
 * baseline): appears 700+ times in the 414 KB `01-home.html` /
 * `02-modal-opened.html` / `03-after-prelogin.html` real-captured
 * lobby snapshots — the marker is unambiguous and PII-free.
 *
 * <p>TODO (real-harvest milestone): once the operator harvests real
 * fixtures for the 8 post-pre-login phases (04-login-action onwards),
 * replace this single marker with phase-specific markers (e.g. auth
 * phase asserts `'api/v2/auth/login'`, otp-trigger asserts
 * `'integ_otp_challenge'`, dashboard asserts `'bff-balancetransactions'`,
 * scrape asserts `'transactions/list'`) so the per-phase contract
 * carries richer structural meaning. Tracked under the same
 * milestone as Isracard/AMEX/MAX/VisaCal TODOs.
 */
const BEINLEUMI_BANK_MARKER = 'fibi.co.il';

/**
 * Ordered step names covered by Mode A static drive.
 *
 * <p>The 02 / 03 step names reflect Beinleumi's real Angular-iframe
 * lobby journey (search box → "כניסה עם סיסמה" modal opens →
 * Angular form hydrates), NOT the MAX / AMEX / Isracard / VisaCal
 * naming. Operator's per-bank cross-validation rule explicitly
 * forbids reusing another bank's step names where the captured DOM
 * state differs.
 *
 * <p>Step `05-otp-trigger` and `06-otp-fill` are Beinleumi-distinct
 * — no prior bank in the Phase-11 series has exercised OTP phases
 * with explicit manifest transitions (Hapoalim collapses OTP in its
 * Mode B manifest). These two stubs assert the simulator's
 * `integ_otp_challenge` nonce-issue / nonce-verify contract.
 *
 * <p>Step `10-scrape-transactions` is named after Beinleumi's
 * `bff-balancetransactions/api/v1/transactions/list` endpoint (NOT
 * Isracard's `CurrentBilling`, AMEX's `CardsTransactionsList`, MAX's
 * `TransactionsAndGraphs`, or VisaCal's `getCardTransactionsDetails`)
 * to surface the per-bank API divergence in the fixture inventory.
 *
 * <p>SCRAPE / TERMINATE phases are exercised by Mode B SIMULATOR
 * (responses live under `responses/`), not Mode A.
 */
const PHASE_11_STEP_NAMES = [
  '01-home',
  '02-modal-opened',
  '03-after-prelogin',
  '04-login-action',
  '05-otp-trigger',
  '06-otp-fill',
  '07-auth-discovery',
  '08-account-resolve',
  '09-dashboard',
  '10-scrape-transactions',
  '11-balance',
] as const;

/**
 * Ordered list of Beinleumi phase expectations driven by Mode A.
 * Maps the production PHASE_CHAIN to the Beinleumi phase HTML files
 * under `fixtures/banks/beinleumi/`. Built via `.map()` over the
 * config array — no duplication.
 */
const PHASE_EXPECTATIONS = PHASE_11_STEP_NAMES.map(
  (stepName): IPhaseExpectation => ({
    stepName,
    mustContain: [BEINLEUMI_BANK_MARKER],
  }),
);

export { PHASE_EXPECTATIONS };
export type { IPhaseExpectation };
