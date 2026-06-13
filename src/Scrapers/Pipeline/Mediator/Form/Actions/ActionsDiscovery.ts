/**
 * Discovery-based fill path — fill fields from PRE-resolved targets
 * via sealed executor; no field resolution in ACTION.
 *
 * <p>Phase 12d split: extracted from {@link ../LoginFormActions.ts}.
 * Isolated from ActionsFill.ts so the §16.1 R-NO-CLEAR-LOG-CRED canary
 * (future) has a clean lint surface on the classic-fill module.
 */

import { ScraperErrorTypes } from '../../../../Base/ErrorTypes.js';
import type { ScraperLogger } from '../../../Types/Debug.js';
import { type MaskedText, maskVisibleText } from '../../../Types/LogEvent.js';
import type { ILoginFieldDiscovery, IResolvedTarget } from '../../../Types/PipelineContext.js';
import type { Procedure } from '../../../Types/Procedure.js';
import { fail, succeed } from '../../../Types/Procedure.js';
import type { IActionMediator } from '../../Elements/ElementMediator.js';
import { validateCredentials } from '../LoginFormFill.js';
import {
  gateNoSubmitSignal,
  type IFillFromDiscoveryArgs,
  type ISubmitPhaseResult,
  type ISubmitResult,
  logFillCount,
  logSubmitResult,
  resolveSubmitFromPhase,
} from './ActionsTypes.js';

/** Bundled args for filling one discovery field. */
interface IFillOneArgs {
  readonly executor: IFillFromDiscoveryArgs['executor'];
  readonly target: IResolvedTarget;
  readonly value: string;
  readonly logger: ScraperLogger;
}

/**
 * Log a field fill from discovery target.
 * @param target - Pre-resolved target.
 * @param logger - Pipeline logger.
 * @returns The masked field name.
 */
function logDiscoveryFill(target: IResolvedTarget, logger: ScraperLogger): MaskedText {
  const masked = maskVisibleText(target.candidateValue);
  logger.debug({ field: masked, result: 'FOUND' });
  return masked;
}

/**
 * Fill one field from discovery via the sealed executor.
 * @param args - Bundled single-field fill arguments.
 * @returns Succeed(true) after fill.
 */
async function fillOneDiscoveryField(args: IFillOneArgs): Promise<Procedure<boolean>> {
  logDiscoveryFill(args.target, args.logger);
  await args.executor.fillInput(args.target.contextId, args.target.selector, args.value);
  return succeed(true);
}

/**
 * Validate all credentials exist before filling.
 * @param entries - Discovery entries with keys and targets.
 * @param creds - Credential map.
 * @returns Failure if any missing, succeed(true) if all present.
 */
function validateDiscoveryCredentials(
  entries: readonly (readonly [string, IResolvedTarget])[],
  creds: Record<string, string>,
): Procedure<boolean> {
  const missing = entries.filter(([key]) => !creds[key]);
  const missingKeys = missing.map(([key]) => key);
  if (missingKeys.length > 0) {
    const msg = `Missing credential: ${missingKeys[0]}`;
    return fail(ScraperErrorTypes.Generic, msg);
  }
  return succeed(true);
}

/**
 * Reduce one field fill onto the accumulator promise.
 * @param args - Bundled fill-from-discovery arguments.
 * @param acc - Running accumulator promise.
 * @param entry - Map entry [key, target].
 * @returns Updated accumulator.
 */
function reduceDiscoveryFill(
  args: IFillFromDiscoveryArgs,
  acc: Promise<Procedure<boolean>>,
  entry: readonly [string, IResolvedTarget],
): Promise<Procedure<boolean>> {
  const [key, target] = entry;
  return acc.then(prev => {
    if (!prev.success) return prev;
    const value = args.creds[key];
    return fillOneDiscoveryField({ executor: args.executor, target, value, logger: args.logger });
  });
}

/**
 * Fill all fields from discovery targets via frame registry + deepFillInput.
 * No field resolution — uses pre-resolved contextId + selector from PRE.
 * @param args - Bundled fill-from-discovery arguments.
 * @returns Procedure succeed(true) on success.
 */
async function fillFieldsFromDiscovery(args: IFillFromDiscoveryArgs): Promise<Procedure<boolean>> {
  const entries = [...args.discovery.targets.entries()];
  const validation = validateDiscoveryCredentials(entries, args.creds);
  if (!validation.success) return validation;
  const initialResult = succeed(true);
  const seed: Promise<Procedure<boolean>> = Promise.resolve(initialResult);
  return entries.reduce(
    (acc: Promise<Procedure<boolean>>, entry): Promise<Procedure<boolean>> =>
      reduceDiscoveryFill(args, acc, entry),
    seed,
  );
}

/**
 * Try pressing Enter via sealed executor.
 * @param executor - Sealed action mediator.
 * @param activeFrameId - Opaque contextId of the frame with fields.
 * @param logger - Pipeline logger.
 * @returns True only when pressEnter resolved against a non-empty
 *   frame ID; false when the ID is empty OR pressEnter rejected.
 */
async function tryEnterFromDiscovery(
  executor: IActionMediator,
  activeFrameId: string,
  logger: ScraperLogger,
): Promise<boolean> {
  if (!activeFrameId) return false;
  logger.debug({ method: 'enter', url: maskVisibleText(activeFrameId) });
  return executor
    .pressEnter(activeFrameId)
    .then((): true => true)
    .catch((): false => false);
}

/**
 * Map a clickElement rejection to a uniform Procedure failure.
 * Extracted from tryClickSubmitFromDiscovery to keep its body ≤10 LoC.
 * @param error - Rejection value from the click promise.
 * @returns Failure with normalized "click rejected: …" message.
 */
function mapClickRejection(error: unknown): Procedure<boolean> {
  const msg = error instanceof Error ? error.message : String(error);
  return fail(ScraperErrorTypes.Generic, `click rejected: ${msg}`);
}

/**
 * Try clicking the submit button from a PRE-resolved discovery target.
 * Mirrors `tryClickSubmit` shape so the discovery path reports real
 * click outcomes instead of swallowing errors silently.
 * @param executor - Sealed action mediator.
 * @param discovery - Login field discovery with optional submit target.
 * @param logger - Pipeline logger.
 * @returns succeed(true) on click, succeed(false) when no submit target,
 *   fail when the click rejected.
 */
async function tryClickSubmitFromDiscovery(
  executor: IActionMediator,
  discovery: ILoginFieldDiscovery,
  logger: ScraperLogger,
): Promise<Procedure<boolean>> {
  if (!discovery.submitTarget.has) return succeed(false);
  const target = discovery.submitTarget.value;
  logger.debug({ method: 'click', url: maskVisibleText(target.candidateValue) });
  return executor
    .clickElement({ contextId: target.contextId, selector: target.selector })
    .then((): Procedure<boolean> => succeed(true))
    .catch(mapClickRejection);
}

/**
 * Run the discovery-mode submit attempts (Enter + Click) and capture
 * both outcomes. Mirrors `runSubmitPhase` so the caller can decide.
 * @param args - Bundled fill-from-discovery arguments.
 * @returns Bundle of `didEnter` + `clickResult`.
 */
async function submitViaDiscovery(args: IFillFromDiscoveryArgs): Promise<ISubmitPhaseResult> {
  const { executor, logger, discovery } = args;
  const didEnter = await tryEnterFromDiscovery(executor, discovery.activeFrameId, logger);
  const clickResult = await tryClickSubmitFromDiscovery(executor, discovery, logger);
  return { didEnter, clickResult };
}

/**
 * Run the prerequisites for discovery-mode submit: log field count,
 * validate credentials, and fill all discovered fields. Extracted
 * from fillFromDiscovery to keep its body ≤10 LoC.
 * @param args - Bundled fill-from-discovery arguments.
 * @returns Procedure succeed(true) when ready to submit; failure propagated.
 */
async function runDiscoveryPrereqs(args: IFillFromDiscoveryArgs): Promise<Procedure<true>> {
  logFillCount(args.logger, args.discovery.targets.size);
  const validation = validateCredentials(args.config.fields, args.creds);
  if (!validation.success) return validation;
  const fillResult = await fillFieldsFromDiscovery(args);
  if (!fillResult.success) return fillResult;
  return succeed(true);
}

export { type IFillFromDiscoveryArgs } from './ActionsTypes.js';

/**
 * Fill from PRE-resolved field discovery + submit via sealed executor.
 * No field resolution in ACTION — all targets come from PRE discovery.
 * Mirrors `fillAndSubmit` shape: propagates click-failure when Enter
 * never fired, and refuses to claim success when nothing fired at all.
 * @param args - Bundled fill-from-discovery arguments.
 * @returns Procedure with ISubmitResult.
 */
export async function fillFromDiscovery(
  args: IFillFromDiscoveryArgs,
): Promise<Procedure<ISubmitResult>> {
  const prereqs = await runDiscoveryPrereqs(args);
  if (!prereqs.success) return prereqs;
  const submit = await submitViaDiscovery(args);
  if (!submit.clickResult.success && !submit.didEnter) return submit.clickResult;
  const gate = gateNoSubmitSignal(submit);
  if (!gate.success) return gate;
  const method = resolveSubmitFromPhase(submit);
  logSubmitResult(args.logger, args.executor, method);
  return succeed({ success: true, method });
}
