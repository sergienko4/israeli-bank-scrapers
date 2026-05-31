/**
 * TurnstileCheckboxSolver — solves Cloudflare Turnstile's "managed
 * checkbox" challenge using the same primitive as hCaptcha.
 *
 * Turnstile and hCaptcha share the exact same UX shape (iframe with a
 * single checkbox) and the same Camoufox auto-pass recipe works for
 * both:
 *   1. networkidle settle
 *   2. WAF_HYDRATION_WAIT_MS static wait for token oracle hydration
 *   3. page.mouse.click(centreX, centreY) on the iframe
 *
 * We delegate to {@link solveHCaptchaCheckbox} rather than copy-paste —
 * the only thing that varies between providers is the iframe URL
 * pattern (handled by the detector), not the click primitive.
 *
 * Kept as a separate exported binding so the solver registry maps
 * one kind → one named solver — a future Turnstile divergence
 * (e.g. visible / interactive widget needing a drag) can be added
 * here without touching the hCaptcha path.
 */

import { solveHCaptchaCheckbox } from './HCaptchaCheckboxSolver.js';
import type { DidSolve, ISolverArgs } from './WafChallengeTypes.js';

/**
 * Solve a Cloudflare Turnstile checkbox via the shared checkbox primitive.
 * @param args - Page + frame bundle from the interceptor.
 * @returns Outcome from the underlying checkbox solver.
 */
async function solveTurnstileCheckbox(args: ISolverArgs): Promise<DidSolve> {
  const outcome = await solveHCaptchaCheckbox(args);
  return outcome;
}

export default solveTurnstileCheckbox;
export { solveTurnstileCheckbox };
