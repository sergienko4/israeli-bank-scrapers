/**
 * Completion snapshot capture — gathers the three completion signals
 * ONCE (no polling) from the supplied ports.
 *
 * <p>Used by a phase FINAL in advisory mode to OBSERVE whether the phase
 * truly completed (spinner cleared, no error, UI advanced) before any
 * enforcing verdict consumes the same signals. Composing the ports here
 * keeps the gathering logic in one phase-agnostic place (no Playwright,
 * no bank, no login internals).
 */

import type { ICompletionPorts, ICompletionSignals } from './CompletionTypes.js';

/**
 * Capture a one-shot completion snapshot from the supplied ports.
 * The two async probes run concurrently; `advanced` is synchronous.
 * @param ports - Phase-supplied completion capability ports.
 * @returns The current completion signals.
 */
async function captureCompletionSignals(ports: ICompletionPorts): Promise<ICompletionSignals> {
  const [isSpinner, hasError] = await Promise.all([ports.isSpinnerVisible(), ports.hasError()]);
  return { spinnerVisible: isSpinner, hasError, advanced: ports.hasAdvanced() };
}

export default captureCompletionSignals;
export { captureCompletionSignals };
