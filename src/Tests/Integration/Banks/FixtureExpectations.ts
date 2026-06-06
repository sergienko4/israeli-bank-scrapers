/**
 * Schema for per-bank fixture expectations — see
 * {@link ./BankFixtureExpectations.ts} for the data table.
 *
 * <p>Open by design: tests iterate steps, banks declare what they need.
 * Adding a new bank = add an entry; no test code change required.
 */

/** Structural invariants for one captured step. */
interface IStepExpectations {
  /** Step name (matches `<step>.html` filename in fixtures dir). */
  readonly stepName: string;
  /** Form `id` attributes that MUST be present in the DOM. */
  readonly requiredFormIds?: readonly string[];
  /** `<input id>` attributes that MUST be present in the DOM. */
  readonly requiredInputIds?: readonly string[];
  /** Visible text the REVEAL action triggers (when the step has one). */
  readonly revealText?: string;
}

/** All expectations for one bank. */
interface IBankFixtureExpectations {
  readonly bankId: string;
  /** Origin Mode-B intercept routes traffic for (e.g. `https://digital.isracard.co.il`). */
  readonly originUrl: string;
  /**
   * Step name to load when driving the production LOGIN PRE pipeline.
   * Typically the last step (after all flips/clicks).
   */
  readonly loginStep: string;
  /**
   * The `<form id>` that LOGIN PRE discovery MUST target. For
   * single-form banks this is the only form present; for multi-form
   * lobbies (e.g. Isracard/Amex OTP-vs-password) this disambiguates
   * which form the resolver should land on. Tests assert each resolved
   * field's `closest('form')` matches this id.
   */
  readonly loginFormId?: string;
  /**
   * When true the captured HTML alone is insufficient (SPA — form is
   * rendered post-JS); LOGIN PRE drive tests SKIP for this bank until
   * first-party assets are captured.
   */
  readonly requiresHydration: boolean;
  readonly steps: readonly IStepExpectations[];
}

export type { IBankFixtureExpectations, IStepExpectations };
