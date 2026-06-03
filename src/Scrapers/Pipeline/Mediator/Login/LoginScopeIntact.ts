/**
 * LOGIN.POST scope-intact validator + OTP disambiguator.
 *
 * <p>Phase 2d strict-cluster split: extracted from
 * {@link ./LoginPhaseActions.ts}.
 */

import { ScraperErrorTypes } from '../../../Base/ErrorTypes.js';
import { maskVisibleText } from '../../Types/LogEvent.js';
import {
  type IPipelineContext,
  type IResolvedTarget,
  LOGIN_FIELDS,
} from '../../Types/PipelineContext.js';
import type { IProcedureFailure, Procedure } from '../../Types/Procedure.js';
import { fail } from '../../Types/Procedure.js';
import type { IElementMediator, IRaceResult } from '../Elements/ElementMediator.js';
import { detectOtpForm, detectOtpTrigger } from '../Form/OtpProbe.js';
import { hasStayedOnLoginUrl } from './LoginUrlHelpers.js';

/** Diagnostic log messages used by {@link validateActionScopeIntact}. */
const SCOPE_OTP_VISIBLE_LOG = 'POST: scope intact but OTP screen rendered — fall through';
const SCOPE_OTP_UNKNOWN_LOG = 'POST: OTP probe failed — fall through (unknown ≠ invalid)';
const SCOPE_INTACT_FAIL_MSG =
  'LOGIN POST: scope intact + URL unchanged — credentials likely invalid';

/** Bundled state for {@link emitScopeIntactFailure}. */
interface IScopeIntactArgs {
  readonly input: IPipelineContext;
  readonly selector: string;
  readonly count: number;
}

/** Result of {@link probeScopeIntact} — target + count or `false`. */
type ScopeProbe = { readonly target: IResolvedTarget; readonly count: number } | false;

/**
 * Emit the structured "scope intact + URL unchanged" failure.
 * @param args - Bundled scope state.
 * @returns Failure procedure tagged `InvalidPassword`.
 */
function emitScopeIntactFailure(args: IScopeIntactArgs): IProcedureFailure {
  const masked = maskVisibleText(args.selector);
  const countStr = String(args.count);
  args.input.logger.debug({
    message: `POST: scope intact + URL unchanged — selector ${masked} count=${countStr}`,
  });
  return fail(ScraperErrorTypes.InvalidPassword, SCOPE_INTACT_FAIL_MSG);
}

/** Lookup mapping OTP-visibility verdicts → the fall-through trace log. */
const SCOPE_OTP_FALLTHROUGH_LOGS: Partial<Record<string, string>> = {
  true: SCOPE_OTP_VISIBLE_LOG,
  unknown: SCOPE_OTP_UNKNOWN_LOG,
};

/**
 * Tri-state outcome for {@link otpScreenVisible}.
 */
type OtpScreenVisibility = boolean | 'unknown';

/** Outcome of a single OTP detect call. */
type ProbeOutcome = IRaceResult | 'failed';

/** Sentinel for {@link runOtpDetect}'s catch arm. */
const PROBE_FAILED: ProbeOutcome = 'failed';

/**
 * Translate a Procedure into a flat ProbeOutcome.
 * @param result - Probe-side Procedure result.
 * @returns Race result on success; `'failed'` on `success: false`.
 */
function unwrapOtpProcedure(result: Procedure<IRaceResult>): ProbeOutcome {
  if (!result.success) return PROBE_FAILED;
  return result.value;
}

/**
 * Run a single OTP detect probe and translate into a flat ProbeOutcome.
 * @param probe - OTP-screen detector function.
 * @param mediator - Element mediator.
 * @returns Race result on success; `'failed'` on resolver rejection.
 */
async function runOtpDetect(
  probe: (m: IElementMediator) => Promise<Procedure<IRaceResult>>,
  mediator: IElementMediator,
): Promise<ProbeOutcome> {
  const result = await probe(mediator).catch((): false => false);
  if (result === false) return PROBE_FAILED;
  return unwrapOtpProcedure(result);
}

/**
 * Probe the post-submit DOM for an OTP-trigger or OTP-input element.
 * @param mediator - Element mediator.
 * @returns Tri-state OTP visibility verdict.
 */
async function otpScreenVisible(mediator: IElementMediator): Promise<OtpScreenVisibility> {
  const triggerProbe = runOtpDetect(detectOtpTrigger, mediator);
  const formProbe = runOtpDetect(detectOtpForm, mediator);
  const [triggerOutcome, formOutcome] = await Promise.all([triggerProbe, formProbe]);
  if (triggerOutcome !== 'failed' && triggerOutcome.found) return true;
  if (formOutcome !== 'failed' && formOutcome.found) return true;
  if (triggerOutcome === 'failed' || formOutcome === 'failed') return 'unknown';
  return false;
}

/**
 * Resolve the fall-through trace log for an OTP visibility verdict.
 * @param visibility - Tri-state OTP-visibility verdict.
 * @returns Trace log string when fall-through applies, else `false`.
 */
function pickOtpFallthroughLog(visibility: OtpScreenVisibility): string | false {
  if (visibility === false) return false;
  const key = visibility === true ? 'true' : 'unknown';
  return SCOPE_OTP_FALLTHROUGH_LOGS[key] ?? false;
}

/**
 * Log fall-through and return `false` so the caller can compose in one line.
 * @param scopeArgs - Scope-intact bundle (for the logger).
 * @param message - Pre-built fall-through trace log.
 * @returns Always `false`.
 */
function emitFallthroughLog(scopeArgs: IScopeIntactArgs, message: string): false {
  scopeArgs.input.logger.debug({ message });
  return false;
}

/**
 * Disambiguate "ambiguous scope intact" via the OTP-screen probe.
 * @param mediator - Element mediator (for the OTP probe).
 * @param scopeArgs - Bundled scope state.
 * @returns Failure procedure on confirmed scope-intact failure, else `false`.
 */
async function disambiguateScopeIntact(
  mediator: IElementMediator,
  scopeArgs: IScopeIntactArgs,
): Promise<Procedure<IPipelineContext> | false> {
  const otpVisibility = await otpScreenVisible(mediator);
  const fallthrough = pickOtpFallthroughLog(otpVisibility);
  if (fallthrough !== false) return emitFallthroughLog(scopeArgs, fallthrough);
  return emitScopeIntactFailure(scopeArgs);
}

/**
 * Get the password target from the pipeline context if discovery has it.
 * @param input - Pipeline context.
 * @returns Resolved password target, or `false`.
 */
function getPasswordTarget(input: IPipelineContext): IResolvedTarget | false {
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
async function probeCountTarget(
  mediator: IElementMediator,
  target: IResolvedTarget,
): Promise<ScopeProbe> {
  const count = await mediator.countBySelector(target.selector);
  if (count === 0) return false;
  return { target, count };
}

/**
 * Run the cheap structural pre-checks for {@link validateActionScopeIntact}.
 * @param mediator - Element mediator.
 * @param input - Pipeline context.
 * @returns Resolved target + count when guards pass, otherwise `false`.
 */
async function probeScopeIntact(
  mediator: IElementMediator,
  input: IPipelineContext,
): Promise<ScopeProbe> {
  if (!hasStayedOnLoginUrl(mediator, input)) return false;
  const target = getPasswordTarget(input);
  if (target === false) return false;
  return probeCountTarget(mediator, target);
}

/**
 * Build the scope-intact bundle from the probe outcome.
 * @param input - Pipeline context.
 * @param probe - Non-false probe outcome.
 * @param probe.target - Resolved password target.
 * @param probe.count - Match count for the target selector.
 * @returns Scope-intact bundle.
 */
function makeScopeArgs(
  input: IPipelineContext,
  probe: { target: IResolvedTarget; count: number },
): IScopeIntactArgs {
  return { input, selector: probe.target.selector, count: probe.count };
}

/**
 * M2 (CI quality hardening) — scope-bound LOGIN.POST validation.
 * Combines URL stability + password target presence + OTP screen probe.
 * @param mediator - Element mediator.
 * @param input - Pipeline context.
 * @returns Failure procedure when scope is broken, otherwise `false`.
 */
async function validateActionScopeIntact(
  mediator: IElementMediator,
  input: IPipelineContext,
): Promise<Procedure<IPipelineContext> | false> {
  const probe = await probeScopeIntact(mediator, input);
  if (probe === false) return false;
  const scopeArgs = makeScopeArgs(input, probe);
  return disambiguateScopeIntact(mediator, scopeArgs);
}

export default validateActionScopeIntact;
export { validateActionScopeIntact };
