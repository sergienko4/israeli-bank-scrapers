/**
 * LOGIN-zone adapter — binds concrete login probes to the phase-agnostic
 * {@link ICompletionPorts} so the completion verifier never imports
 * Playwright or login internals (Dependency Inversion).
 *
 * <p>The three login-local completion axes:
 * <ul>
 *   <li><b>spinner</b> — a loading indicator is still visible
 *       (reuses {@link buildIsLoadingVisible}, the strict probe).</li>
 *   <li><b>error</b> — an error marker is present in the active frame
 *       (reuses {@link safeScanFrame}, the LOGIN.post error scan).</li>
 *   <li><b>advanced</b> — the UI left the login URL
 *       (negation of {@link hasStayedOnLoginUrl}).</li>
 * </ul>
 *
 * <p>These are LOGIN-LOCAL signals only — no `WK_DASHBOARD.REVEAL`
 * probe — so the adapter does NOT breach R-AUTH-DISCOVERY-OWN: proving the
 * dashboard reveal stays with AUTH-DISCOVERY.
 */

import type { Frame, Page } from 'playwright-core';

import type { IPipelineContext } from '../../Types/PipelineContext.js';
import { isOk } from '../../Types/Procedure.js';
import type { ICompletionPorts } from '../Completion/CompletionTypes.js';
import { buildIsLoadingVisible } from '../Elements/Create/index.js';
import type { IElementMediator } from '../Elements/ElementMediator.js';
import { safeScanFrame } from './LoginFrameScan.js';
import { hasStayedOnLoginUrl } from './LoginUrlHelpers.js';

/** Inputs the LOGIN adapter binds into the completion ports. */
interface ILoginCompletionPortsArgs {
  readonly mediator: IElementMediator;
  readonly input: IPipelineContext;
  readonly frame: Page | Frame;
}

/** Strict single-shot spinner probe, built once at module load. */
const PROBE_SPINNER = buildIsLoadingVisible();

/**
 * Resolve whether a loading indicator is visible in the frame.
 * Unwraps the probe Procedure to a plain boolean (false on failure).
 * @param frame - Active login frame or page.
 * @returns True when a spinner is visible.
 */
async function spinnerVisible(frame: Page | Frame): Promise<boolean> {
  const probe = await PROBE_SPINNER(frame);
  return isOk(probe) && probe.value;
}

/**
 * Resolve whether the active frame shows a login error marker.
 * @param mediator - Element mediator used to scan the frame.
 * @param frame - Active login frame or page.
 * @returns True when the frame scan reports errors.
 */
async function errorVisible(mediator: IElementMediator, frame: Page | Frame): Promise<boolean> {
  const scan = await safeScanFrame(mediator, frame);
  return scan.hasErrors;
}

/**
 * Resolve whether the UI advanced past the login URL.
 * @param mediator - Element mediator exposing the current URL.
 * @param input - Pipeline context carrying the captured login URL.
 * @returns True when the page left the login URL.
 */
function advancedPastLogin(mediator: IElementMediator, input: IPipelineContext): boolean {
  return !hasStayedOnLoginUrl(mediator, input);
}

/**
 * Build login-local completion ports for the active frame. Each port is
 * a pre-bound named probe so the verifier stays Playwright-free (DIP).
 *
 * @param args - Mediator, pipeline context, and active login frame.
 * @returns Completion ports bound to the login probes.
 */
function buildLoginCompletionPorts(args: ILoginCompletionPortsArgs): ICompletionPorts {
  const { mediator, input, frame } = args;
  return {
    isSpinnerVisible: spinnerVisible.bind(null, frame),
    hasError: errorVisible.bind(null, mediator, frame),
    hasAdvanced: advancedPastLogin.bind(null, mediator, input),
  };
}

export default buildLoginCompletionPorts;
export { buildLoginCompletionPorts };
