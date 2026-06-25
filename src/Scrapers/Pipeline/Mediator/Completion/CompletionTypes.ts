/**
 * Completion-signal contracts — the narrow ports a phase FINAL supplies
 * and the snapshot the verifier produces.
 *
 * <p>Phase-agnostic by design: this module knows nothing about banks,
 * login URLs, OTP, or Playwright. Each phase zone owns a small adapter
 * that binds concrete probes (spinner / error scan / advanced-past-start)
 * to these ports, so the completion logic stays decoupled (DIP) and the
 * verifier can be reused by LOGIN.final, OTP-FILL.final, and others
 * without per-phase branching (OCP).
 */

/** One observed completion snapshot — three independent signals. */
export interface ICompletionSignals {
  /** A loading indicator is still visible (the phase has not settled). */
  readonly spinnerVisible: boolean;
  /** An error marker is present in the scanned frame. */
  readonly hasError: boolean;
  /** The UI advanced past the phase start screen (e.g. left the login form). */
  readonly advanced: boolean;
}

/**
 * Narrow capability ports — bound by the consuming phase adapter (DIP).
 * Pre-bound to the live frame/page so the verifier stays Playwright-free.
 */
export interface ICompletionPorts {
  /** Resolve true when a loading indicator is currently visible. */
  readonly isSpinnerVisible: () => Promise<boolean>;
  /** Resolve true when an error marker is present in the scanned frame. */
  readonly hasError: () => Promise<boolean>;
  /** Return true when the UI has advanced past the phase start screen. */
  readonly hasAdvanced: () => boolean;
}
