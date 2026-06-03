/**
 * HomeActions.Validate — login-area validation extracted from the
 * Phase 5 HomeActions sibling so the barrel stays under the per-file
 * LoC cap (phase-2e-residue).
 */

import type { SelectorCandidate } from '../../../Base/Config/LoginConfig.js';
import { ScraperErrorTypes } from '../../../Base/ErrorTypes.js';
import { WK_HOME } from '../../Registry/WK/HomeWK.js';
import type { ScraperLogger } from '../../Types/Debug.js';
import type { IPipelineContext } from '../../Types/PipelineContext.js';
import type { Procedure } from '../../Types/Procedure.js';
import { fail, succeed } from '../../Types/Procedure.js';
import type { IElementMediator } from '../Elements/ElementMediator.js';
import { HOME_ENTRY_TIMEOUT_MS } from '../Timing/TimingConfig.js';

/** Bundled args for login area validation. */
interface IValidateLoginAreaArgs {
  readonly mediator: IElementMediator;
  readonly input: IPipelineContext;
  readonly homepageUrl: string;
  readonly logger: ScraperLogger;
}

/** Aggregated diagnostic signals used to decide login-area presence. */
interface ILoginAreaSignals {
  readonly didNavigate: boolean;
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
 * Decide whether ANY of the three signals indicates the login area is present.
 * @param signals - Aggregated nav / frame / form signals.
 * @returns True when any signal indicates login-area presence.
 */
function loginAreaDetected(signals: ILoginAreaSignals): boolean {
  return signals.didNavigate || signals.frameCount > 1 || signals.hasLoginForm;
}

/**
 * Collect the three login-area presence signals.
 * Pulled out so {@link executeValidateLoginArea} stays a thin guard + delegate.
 * @param args - Bundled validation arguments.
 * @returns Aggregated nav / frame / form signals.
 */
async function collectLoginAreaSignals(args: IValidateLoginAreaArgs): Promise<ILoginAreaSignals> {
  const didNavigate = args.mediator.getCurrentUrl() !== args.homepageUrl;
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
export { executeValidateLoginArea };
