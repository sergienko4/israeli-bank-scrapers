/**
 * Leumi bank — per-phase structural-invariant configuration.
 *
 * <p>Mirrors {@link ../Beinleumi/BeinleumiPhaseConfig.ts},
 * {@link ../Discount/DiscountPhaseConfig.ts}, and the other pipeline
 * banks. Markers are GENERIC bank-identity substrings (no PII) that
 * survive both the real operator harvest AND a re-harvest. The Mode A
 * static drive proves every committed Leumi fixture matches the marker
 * contract the production scraper's recipe + post-login waitFor relies
 * on, deterministically, offline, no creds.
 *
 * <p>Leumi has NO pre-login phase — `LeumiPipeline.ts` builds the
 * pipeline as `.withBrowser().withDeclarativeLogin(LEUMI_LOGIN)` (no
 * `.withPreLogin()` / `.withOtp*()`). The real-website journey is
 * INIT → HOME → LOGIN → AUTH-DISCOVERY → ACCOUNT-RESOLVE → DASHBOARD →
 * SCRAPE → BALANCE-RESOLVE → TERMINATE, so the fixture step list omits
 * the 02/03 pre-login and 05/06 OTP steps that OTP-gated banks ship.
 *
 * <p>Leumi-distinct from MAX / Isracard / AMEX / VisaCal / Beinleumi
 * fixtures — the marker `leumi.co.il` is unique to Leumi (the marketing
 * lobby `www.leumi.co.il/he` and the post-login SPA host
 * `hb2.bankleumi.co.il` both carry it). A Mode A regression accidentally
 * pointing Leumi at another bank's fixture root would fail loudly,
 * proving the per-bank cross-validation.
 */

/** Per-phase contract — what markers MUST appear in the captured HTML. */
interface IPhaseExpectation {
  readonly stepName: string;
  readonly mustContain: readonly string[];
}

/**
 * Generic bank-identity marker — present in every real Leumi page
 * (lobby `www.leumi.co.il`, gate-keeper + SPA host `bankleumi.co.il`,
 * canonical links). Empirically present in all 7 committed fixtures
 * (01-home through 11-balance). PII-free.
 */
const LEUMI_BANK_MARKER = 'leumi.co.il';

/**
 * Ordered step names covered by Mode A static drive.
 *
 * <p>Matches the committed `fixtures/banks/leumi/<step>.html` files and
 * the `BankFixtureExpectations` row. The 02/03/05/06 step names are
 * intentionally absent — Leumi's declarative login has no pre-login or
 * OTP phase (see the file-level note).
 */
const PHASE_11_STEP_NAMES = [
  '01-home',
  '04-login-action',
  '07-auth-discovery',
  '08-account-resolve',
  '09-dashboard',
  '10-scrape-transactions',
  '11-balance',
] as const;

/**
 * Ordered list of Leumi phase expectations driven by Mode A. Built via
 * `.map()` over the config array — no duplication.
 */
const PHASE_EXPECTATIONS = PHASE_11_STEP_NAMES.map(
  (stepName): IPhaseExpectation => ({
    stepName,
    mustContain: [LEUMI_BANK_MARKER],
  }),
);

export { PHASE_EXPECTATIONS };
export type { IPhaseExpectation };
