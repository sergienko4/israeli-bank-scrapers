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

/** Shorthand for a single map entry [credKey, resolvedTarget]. */
type DiscoveryEntry = readonly [string, IResolvedTarget];
/** Shorthand for the readonly array of discovery entries. */
type DiscoveryEntries = readonly DiscoveryEntry[];

/** Bundled args for credential-set validation. */
interface IValidateArgs {
  readonly entries: DiscoveryEntries;
  readonly creds: Record<string, string>;
}

/** Bundled args for one reducer step in the discovery fill chain. */
interface IProcessEntryArgs {
  readonly args: IFillFromDiscoveryArgs;
  readonly prev: Procedure<boolean>;
  readonly entry: DiscoveryEntry;
}

/** Bundled args for the discovery-mode finalize chain. */
interface IFinalizeArgs {
  readonly submit: ISubmitPhaseResult;
  readonly fill: IFillFromDiscoveryArgs;
}

/** Bundled args for one reducer step (per-entry fill). */
interface IReduceArgs {
  readonly args: IFillFromDiscoveryArgs;
  readonly acc: Promise<Procedure<boolean>>;
  readonly entry: DiscoveryEntry;
}

/** Bundled args for the reducer driver `runDiscoveryReducer`. */
interface IRunReducerArgs {
  readonly args: IFillFromDiscoveryArgs;
  readonly entries: DiscoveryEntries;
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

/** Sentinel returned when no missing credential is found. Avoids `string | undefined`. */
const NO_MISSING_KEY = '';

/**
 * Find the first credential key for which no value is provided.
 * Extracted from {@link validateDiscoveryCredentials} for cap drain.
 * Returns {@link NO_MISSING_KEY} (`''`) when every key is satisfied —
 * field keys are non-empty identifiers (`username`, `password`, …),
 * so an empty-string sentinel is unambiguous.
 * @param p - Bundled `entries` + `creds`.
 * @returns Key of the first missing credential, or `''` if all present.
 */
function findMissingCredKey(p: IValidateArgs): string {
  const missing = p.entries.find(([key]): boolean => !p.creds[key]);
  if (!missing) return NO_MISSING_KEY;
  return missing[0];
}

/**
 * Validate all credentials exist before filling.
 * @param p - Bundled `entries` + `creds`.
 * @returns Failure if any missing, succeed(true) if all present.
 */
function validateDiscoveryCredentials(p: IValidateArgs): Procedure<boolean> {
  const missingKey = findMissingCredKey(p);
  if (missingKey === NO_MISSING_KEY) return succeed(true);
  return fail(ScraperErrorTypes.Generic, `Missing credential: ${missingKey}`);
}

/**
 * Build the per-field bundle for one discovery entry. Extracted from
 * {@link processDiscoveryEntry} to keep that function ≤10 LoC by
 * lifting the object-literal construction (cap-10 tightening).
 * @param args - Bundled fill-from-discovery arguments.
 * @param entry - Map entry [key, target].
 * @returns Single-field args bundle ready for fillOneDiscoveryField.
 */
function buildOneFieldArgs(args: IFillFromDiscoveryArgs, entry: DiscoveryEntry): IFillOneArgs {
  const [key, target] = entry;
  return { executor: args.executor, target, value: args.creds[key], logger: args.logger };
}

/**
 * Run the fill for a single map entry once the previous step succeeded.
 * Extracted from {@link reduceDiscoveryFill} for cap drain.
 * @param p - Bundled fill args, prior step result, and current entry.
 * @returns Procedure: prev when failed; new fill result otherwise.
 */
async function processDiscoveryEntry(p: IProcessEntryArgs): Promise<Procedure<boolean>> {
  if (!p.prev.success) return p.prev;
  const oneArgs = buildOneFieldArgs(p.args, p.entry);
  return fillOneDiscoveryField(oneArgs);
}

/**
 * Reduce one field fill onto the accumulator promise.
 * @param r - Bundled reducer args (`args`, `acc`, `entry`).
 * @returns Updated accumulator.
 */
function reduceDiscoveryFill(r: IReduceArgs): Promise<Procedure<boolean>> {
  const { args, acc, entry } = r;
  return acc.then(
    (prev): Promise<Procedure<boolean>> => processDiscoveryEntry({ args, prev, entry }),
  );
}

/**
 * Drive the per-entry fill reducer. Extracted from
 * {@link fillFieldsFromDiscovery} to keep that body ≤10 LoC by
 * lifting the multi-line `entries.reduce` invocation.
 * @param p - Bundled fill args + entries snapshot.
 * @returns Procedure succeed(true) on full success; failure propagated.
 */
async function runDiscoveryReducer(p: IRunReducerArgs): Promise<Procedure<boolean>> {
  const initial = succeed(true);
  const seed: Promise<Procedure<boolean>> = Promise.resolve(initial);
  return p.entries.reduce(
    (acc, entry): Promise<Procedure<boolean>> => reduceDiscoveryFill({ args: p.args, acc, entry }),
    seed,
  );
}

/**
 * Fill all fields from discovery targets via frame registry + deepFillInput.
 * No field resolution — uses pre-resolved contextId + selector from PRE.
 * @param args - Bundled fill-from-discovery arguments.
 * @returns Procedure succeed(true) on success.
 */
async function fillFieldsFromDiscovery(args: IFillFromDiscoveryArgs): Promise<Procedure<boolean>> {
  const entries = [...args.discovery.targets.entries()];
  const validation = validateDiscoveryCredentials({ entries, creds: args.creds });
  if (!validation.success) return validation;
  return runDiscoveryReducer({ args, entries });
}

/**
 * Press Enter via the sealed executor; return `false` on rejection.
 * Extracted from {@link tryEnterFromDiscovery} for cap drain.
 * @param executor - Sealed action mediator.
 * @param frameId - Opaque contextId of the frame with fields.
 * @returns True only when pressEnter resolved.
 */
async function pressEnterByIdOrFalse(executor: IActionMediator, frameId: string): Promise<boolean> {
  try {
    await executor.pressEnter(frameId);
    return true;
  } catch {
    return false;
  }
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
  return pressEnterByIdOrFalse(executor, activeFrameId);
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
 * Click a pre-resolved discovery target; map rejections to Procedure.
 * Extracted from {@link tryClickSubmitFromDiscovery} for cap drain.
 * @param executor - Sealed action mediator.
 * @param target - Pre-resolved submit target.
 * @returns Succeed(true) on click; fail with normalized message otherwise.
 */
async function clickDiscoveryTarget(
  executor: IActionMediator,
  target: IResolvedTarget,
): Promise<Procedure<boolean>> {
  return executor
    .clickElement({ contextId: target.contextId, selector: target.selector })
    .then((): Procedure<boolean> => succeed(true))
    .catch(mapClickRejection);
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
  return clickDiscoveryTarget(executor, target);
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
 * Resolve the fired method, log it, and return the success Procedure.
 * Extracted from {@link finalizeDiscoverySubmit} for cap-10 conformance.
 * @param p - Bundled submit-phase result + fill args.
 * @returns `succeed({ success: true, method })`.
 */
function logAndSucceedDiscovery(p: IFinalizeArgs): Procedure<ISubmitResult> {
  const method = resolveSubmitFromPhase(p.submit);
  logSubmitResult(p.fill.logger, p.fill.executor, method);
  return succeed({ success: true, method });
}

/**
 * Finalize the discovery-mode submit phase: gate phantom-success,
 * resolve the method that fired, and emit the post-submit debug line.
 * Extracted from {@link fillFromDiscovery} to keep it ≤7 statements.
 * @param p - Bundled submit-phase result + fill args.
 * @returns Procedure carrying the final ISubmitResult.
 */
function finalizeDiscoverySubmit(p: IFinalizeArgs): Procedure<ISubmitResult> {
  if (!p.submit.clickResult.success && !p.submit.didEnter) return p.submit.clickResult;
  const gate = gateNoSubmitSignal(p.submit);
  if (!gate.success) return gate;
  return logAndSucceedDiscovery(p);
}

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
  return finalizeDiscoverySubmit({ submit, fill: args });
}
