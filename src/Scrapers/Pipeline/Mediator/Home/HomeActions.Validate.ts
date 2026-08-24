/**
 * HomeActions.Validate — login-area validation extracted from the
 * Phase 5 HomeActions sibling so the barrel stays under the per-file
 * LoC cap (phase-2e-residue).
 */

import type { SelectorCandidate } from '../../../Base/Config/LoginConfig.js';
import { ScraperErrorTypes } from '../../../Base/ErrorTypes.js';
import type { ScraperLogger } from '../../Logging/Debug.js';
import { WK_HOME } from '../../Registry/WK/HomeWK.js';
import type { IPipelineContext } from '../../Types/PipelineContext.js';
import type { Procedure } from '../../Types/Procedure.js';
import { fail, succeed } from '../../Types/Procedure.js';
import type { IElementMediator } from '../Elements/ElementMediator.js';
import { HOME_ENTRY_TIMEOUT_MS } from '../Timing/HomeTimingConfig.js';
import { type DidNavigate, hasLeftHomepage } from './HomeNavigationTruth.js';

/** Bundled args for login area validation. */
interface IValidateLoginAreaArgs {
  readonly mediator: IElementMediator;
  readonly input: IPipelineContext;
  readonly homepageUrl: string;
  readonly logger: ScraperLogger;
}

/** Aggregated diagnostic signals used to decide login-area presence. */
interface ILoginAreaSignals {
  readonly didNavigate: DidNavigate;
  readonly frameCount: number;
  readonly hasLoginForm: boolean;
}

/**
 * Count frames in the browser page when a browser is attached, else 0.
 * @param input - Pipeline context with an Option-shaped browser handle.
 * @returns Frame count (≥ 0) or `0` when no browser is attached.
 */
function countBrowserFrames(input: IPipelineContext): number {
  if (!input.browser.has) return 0;
  return input.browser.value.page.frames().length;
}

/**
 * Probe for a visible login-form gate inside the active context.
 * @param mediator - Element mediator providing the visibility race.
 * @returns True iff the FORM_CHECK gate resolved to a visible element.
 */
async function probeLoginForm(mediator: IElementMediator): Promise<boolean> {
  const formGate = WK_HOME.FORM_CHECK as unknown as readonly SelectorCandidate[];
  const formProbe = await mediator
    .resolveVisible(formGate, HOME_ENTRY_TIMEOUT_MS)
    .catch((): false => false);
  return formProbe !== false && formProbe.found;
}

/**
 * Decide whether HOME reached the login area.
 *
 * <p>Two proofs, both meaningful: the browser left the homepage for a login
 * route, or a login form is now visible (the gate searches every frame, so an
 * embedded cross-origin widget counts).
 *
 * <p>A third term — `frameCount > 1` — was removed. Every bank carries iframes
 * for analytics, chat and ads, so it could not distinguish a login widget from
 * a tracking pixel: live HOME.POST reports 9 frames for Amex, 12 for VisaCal
 * and 2 for Max. Amex and VisaCal never needed it (both report a visible login
 * form); Max was the only bank it carried, and carrying Max was the defect —
 * it masked a click swallowed by a marketing overlay and let the phase report
 * success having navigated nowhere.
 *
 * @param signals - Aggregated nav / frame / form signals.
 * @returns True when the login area is provably present.
 */
function loginAreaDetected(signals: ILoginAreaSignals): boolean {
  return signals.didNavigate || signals.hasLoginForm;
}

/**
 * Collect the login-area presence signals. `frameCount` is retained as a
 * diagnostic only — see {@link loginAreaDetected} for why it no longer votes.
 * @param args - Bundled validation arguments.
 * @returns Aggregated nav / frame / form signals.
 */
async function collectLoginAreaSignals(args: IValidateLoginAreaArgs): Promise<ILoginAreaSignals> {
  const currentUrl = args.mediator.getCurrentUrl();
  const didNavigate = hasLeftHomepage(currentUrl, args.homepageUrl);
  const frameCount = countBrowserFrames(args.input);
  const hasLoginForm = await probeLoginForm(args.mediator);
  args.logger.debug({ didNavigate, frames: frameCount, loginForm: hasLoginForm });
  return { didNavigate, frameCount, hasLoginForm };
}

/**
 * POST: Validate URL changed from homepage OR login iframe appeared.
 * @param args - Bundled validation arguments.
 * @returns Succeed if login area detected, fail otherwise.
 */
async function executeValidateLoginArea(
  args: IValidateLoginAreaArgs,
): Promise<Procedure<IPipelineContext>> {
  const signals = await collectLoginAreaSignals(args);
  if (loginAreaDetected(signals)) return succeed(args.input);
  return fail(ScraperErrorTypes.Generic, 'HOME POST: login area not detected');
}

export type { ILoginAreaSignals, IValidateLoginAreaArgs };
export { collectLoginAreaSignals, executeValidateLoginArea };
