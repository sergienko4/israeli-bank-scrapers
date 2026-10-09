/**
 * Mizrahi — per-phase structural-invariant configuration.
 *
 * <p>Mizrahi logs in with username + password and no OTP. HOME's
 * "כניסה לחשבון" opens a modal whose same-origin iframe
 * (`/login/index.html`) holds the credential form, harvested as
 * `02-login-modal/frame-2`. The post-login steps come from the daytime
 * real-credential harvest.
 *
 * <p>`mizrahi-tefahot.co.il` is the bank-identity marker — present in
 * every committed step and absent from every other bank's fixtures, so a
 * Mode A run pointed at the wrong fixture root fails loudly. PII-free.
 */

/** Per-phase contract — markers that MUST appear in the captured HTML. */
interface IPhaseExpectation {
  readonly stepName: string;
  readonly mustContain: readonly string[];
}

/** Bank-identity marker present in every captured Mizrahi document. */
const MIZRAHI_BANK_MARKER = 'mizrahi-tefahot.co.il';

/** The step holding the credential form (the login iframe document). */
const MIZRAHI_LOGIN_STEP = '02-login-modal/frame-2';

/**
 * Ordered captured steps driven by Mode A — the pre-login steps plus every
 * post-login step the daytime harvest committed (`BankFixtureExpectations`
 * `MIZRAHI_STEPS`). There are no 03–06 steps: no pre-login form, no OTP.
 */
const MIZRAHI_STEP_NAMES = [
  '01-home',
  '02-login-modal',
  MIZRAHI_LOGIN_STEP,
  '07-auth-discovery',
  '08-account-resolve',
  '09-dashboard',
  '10-transactions-view',
  '10-scrape-transactions',
  '11-balance',
] as const;

/** Mode A phase expectations, one per captured step. */
const PHASE_EXPECTATIONS = MIZRAHI_STEP_NAMES.map((stepName): IPhaseExpectation => ({
  stepName,
  mustContain: [MIZRAHI_BANK_MARKER],
}));

export type { IPhaseExpectation };
export { MIZRAHI_LOGIN_STEP, PHASE_EXPECTATIONS };
