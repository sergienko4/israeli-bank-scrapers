/**
 * Completion snapshot capture — gathers the four completion signals
 * ONCE (no polling) from the supplied ports.
 *
 * <p>Used by a phase FINAL in advisory mode to OBSERVE whether the phase
 * truly completed (spinner cleared, no error, UI advanced, form gone)
 * before any enforcing verdict consumes the same signals. Composing the
 * ports here keeps the gathering logic in one phase-agnostic place (no
 * Playwright, no bank, no login internals).
 */

import type { ICompletionPorts, ICompletionSignals } from './CompletionTypes.js';

/**
 * Run the three asynchronous completion probes concurrently.
 * @param ports - Phase-supplied completion capability ports.
 * @returns Tuple of [spinnerVisible, hasError, formPresent].
 */
async function captureAsyncProbes(ports: ICompletionPorts): Promise<[boolean, boolean, boolean]> {
  return Promise.all([ports.isSpinnerVisible(), ports.hasError(), ports.isFormPresent()]);
}

/**
 * Capture a one-shot completion snapshot from the supplied ports.
 * The three async probes run concurrently; `advanced` is synchronous.
 * @param ports - Phase-supplied completion capability ports.
 * @returns The current completion signals.
 */
async function captureCompletionSignals(ports: ICompletionPorts): Promise<ICompletionSignals> {
  const [isSpinnerVisible, hasError, isFormPresent] = await captureAsyncProbes(ports);
  return {
    spinnerVisible: isSpinnerVisible,
    hasError,
    advanced: ports.hasAdvanced(),
    formPresent: isFormPresent,
  };
}
export default captureCompletionSignals;
export { captureCompletionSignals };
