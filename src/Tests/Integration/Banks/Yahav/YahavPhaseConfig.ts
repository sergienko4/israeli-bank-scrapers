/**
 * Yahav bank — per-phase structural-invariant configuration.
 *
 * <p>Mirrors {@link ../Leumi/LeumiPhaseConfig.ts}: markers are GENERIC
 * bank-identity substrings (no PII) that survive both a real operator
 * harvest AND a re-harvest. The Mode A static drive proves every
 * committed Yahav fixture matches the marker contract the production
 * scraper relies on, deterministically, offline, no creds.
 *
 * <p>Yahav has NO pre-login and NO OTP — `YahavPipeline.ts` builds the
 * pipeline as `.withBrowser().withDeclarativeLogin(YAHAV_LOGIN)` (no
 * `.withPreLogin()` / `.withOtp*()`). The journey is INIT → HOME →
 * LOGIN → AUTH-DISCOVERY → ACCOUNT-RESOLVE → DASHBOARD → SCRAPE →
 * BALANCE-RESOLVE → TERMINATE, so the fixture step list omits the
 * 02/03 pre-login and 05/06 OTP steps.
 *
 * <p>Yahav-distinct from other banks — the marker `yahav.co.il` is
 * unique to Yahav (marketing lobby `www.yahav.co.il` + BaNCS SPA host
 * `digital.yahav.co.il`). Pointing Yahav at another bank's fixture root
 * would fail loudly, proving per-bank cross-validation.
 */

/** Per-phase contract — what markers MUST appear in the captured HTML. */
interface IPhaseExpectation {
  readonly stepName: string;
  readonly mustContain: readonly string[];
}

/** Generic bank-identity marker — present in every real Yahav page. PII-free. */
const YAHAV_BANK_MARKER = 'yahav.co.il';

/** Ordered step names covered by Mode A static drive — no pre-login, no OTP. */
const PHASE_11_STEP_NAMES = [
  '01-home',
  '04-login-action',
  '07-auth-discovery',
  '08-account-resolve',
  '09-dashboard',
  '10-scrape-transactions',
  '11-balance',
] as const;

/** Ordered Yahav phase expectations — built via `.map()`, no duplication. */
const PHASE_EXPECTATIONS = PHASE_11_STEP_NAMES.map(
  (stepName): IPhaseExpectation => ({
    stepName,
    mustContain: [YAHAV_BANK_MARKER],
  }),
);

export { PHASE_EXPECTATIONS };
export type { IPhaseExpectation };
