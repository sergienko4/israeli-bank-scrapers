/**
 * Cheap structural pre-checks for the scope-intact validator.
 *
 * <p>Phase 12d split: extracted from {@link ../LoginScopeIntact.ts}.
 */

import {
  type IPipelineContext,
  type IResolvedTarget,
  LOGIN_FIELDS,
} from '../../../Types/PipelineContext.js';
import type { IElementMediator } from '../../Elements/ElementMediator.js';
import { hasStayedOnLoginUrl } from '../LoginUrlHelpers.js';
import {
  type IScopeIntactArgs,
  SCOPE_HIDDEN_FALLTHROUGH_LOG,
  type ScopeProbe,
} from './ScopeIntactTypes.js';

/**
 * Get the password target from the pipeline context if discovery has it.
 * @param input - Pipeline context.
 * @returns Resolved password target, or `false`.
 */
export function getPasswordTarget(input: IPipelineContext): IResolvedTarget | false {
  if (!input.loginFieldDiscovery.has) return false;
  const target = input.loginFieldDiscovery.value.targets.get(LOGIN_FIELDS.PASSWORD);
  return target ?? false;
}

/**
 * Count the password target and bundle with the target on hit.
 * @param mediator - Element mediator (count probe).
 * @param target - Password target from discovery.
 * @returns Target + count bundle, or `false` on zero matches.
 */
export async function probeCountTarget(
  mediator: IElementMediator,
  target: IResolvedTarget,
): Promise<ScopeProbe> {
  const count = await mediator.countBySelector(target.selector);
  if (count === 0) return false;
  return { target, count };
}

/**
 * Drop a probe whose password input is in the DOM but not on screen.
 *
 * <p>A single-page app that ACCEPTED the credentials tears its login view
 * down asynchronously — the input survives in the DOM behind the loading
 * overlay for a moment after a *successful* submit, and the URL never
 * changes. Presence alone therefore reads that page as a rejected login and
 * aborts a session that in fact authenticated. Only a form the user can
 * still see proves the scope really is intact.
 * @param mediator - Element mediator (visibility probe).
 * @param input - Pipeline context (for the trace log).
 * @param probe - Outcome of the presence probe.
 * @returns The probe when the form is on screen, otherwise `false`.
 */
async function requireOnScreen(
  mediator: IElementMediator,
  input: IPipelineContext,
  probe: ScopeProbe,
): Promise<ScopeProbe> {
  if (probe === false) return false;
  if (await mediator.isVisibleBySelector(probe.target.selector)) return probe;
  input.logger.debug({ message: SCOPE_HIDDEN_FALLTHROUGH_LOG });
  return false;
}

/**
 * Run the cheap structural pre-checks for the scope-intact validator.
 * @param mediator - Element mediator.
 * @param input - Pipeline context.
 * @returns Resolved target + count when guards pass, otherwise `false`.
 */
export async function probeScopeIntact(
  mediator: IElementMediator,
  input: IPipelineContext,
): Promise<ScopeProbe> {
  if (!hasStayedOnLoginUrl(mediator, input)) return false;
  const target = getPasswordTarget(input);
  if (target === false) return false;
  const probe = await probeCountTarget(mediator, target);
  return requireOnScreen(mediator, input, probe);
}

/**
 * Build the scope-intact bundle from the probe outcome.
 * @param input - Pipeline context.
 * @param probe - Non-false probe outcome.
 * @param probe.target - Resolved password target.
 * @param probe.count - Match count for the target selector.
 * @returns Scope-intact bundle.
 */
export function makeScopeArgs(
  input: IPipelineContext,
  probe: { target: IResolvedTarget; count: number },
): IScopeIntactArgs {
  return { input, selector: probe.target.selector, count: probe.count };
}
