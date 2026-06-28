/**
 * Classic fill path — resolve fields via mediator (universal anchor),
 * then submit via Enter + Click.
 *
 * <p>Phase 12d split: extracted from {@link ../LoginFormActions.ts}.
 */

import type { Frame, Page } from 'playwright-core';

import type { IFieldConfig } from '../../../../Base/Interfaces/Config/FieldConfig.js';
import type { ScraperLogger } from '../../../Types/Debug.js';
import { maskVisibleText } from '../../../Types/LogEvent.js';
import type { Procedure } from '../../../Types/Procedure.js';
import { succeed } from '../../../Types/Procedure.js';
import type { IElementMediator } from '../../Elements/ElementMediator.js';
import { reduceField, validateCredentials } from '../LoginFormFill.js';
import { type IFillAccum, type IFillContext, passwordFirst } from '../LoginScopeResolver.js';
import { isBenignPressReject } from './ActionsBenignReject.js';
import {
  gateNoSubmitSignal,
  type IFillAllArgs,
  type IFillAllResult,
  type IFillAndSubmitArgs,
  type ISubmitPhaseArgs,
  type ISubmitPhaseResult,
  type ISubmitResult,
  logFillCount,
  logSubmitResult,
  normalizeSubmit,
  resolveSubmitFromPhase,
} from './ActionsTypes.js';
import { readSubmitMode } from './SubmitModeGate.js';

/** Page or Frame context for submit targeting; false when no frame scope is available. */
type FormCtx = Page | Frame | false;

/**
 * Run the sequential `reduceField` chain over an ordered field list.
 * Extracted from `fillAllFields` so each function stays under cap.
 * @param ctx - Fill context bundle.
 * @param ordered - Fields in password-first order.
 * @returns Final accumulator with merged scope + procedure.
 */
async function runFieldReduce(
  ctx: IFillContext,
  ordered: readonly IFieldConfig[],
): Promise<IFillAccum> {
  const seed = Promise.resolve<IFillAccum>({ scope: {}, procedure: succeed(true) });
  return ordered.reduce(
    (p: Promise<IFillAccum>, f: IFieldConfig): Promise<IFillAccum> => reduceField(ctx, p, f),
    seed,
  );
}

/**
 * Fill all credential fields sequentially via mediator.
 * Returns the resolved frame scope for submit targeting.
 * @param args - Bundled fill-all arguments.
 * @returns Fill result with frame context.
 */
export async function fillAllFields(args: IFillAllArgs): Promise<IFillAllResult> {
  const { mediator, fields, creds, logger } = args;
  const validation = validateCredentials(fields, creds);
  if (!validation.success) return { procedure: validation, frameContext: undefined };
  const ordered = passwordFirst(fields);
  const ctx: IFillContext = { mediator, creds, logger };
  const final = await runFieldReduce(ctx, ordered);
  return { procedure: final.procedure, frameContext: final.scope.ctx };
}

/**
 * Press Enter on an input inside the discovered form; return `false`
 * on benign rejection (TimeoutError / no element matches / frame
 * gone) and rethrow unexpected errors so real bugs surface.
 *
 * <p>Form-scope the selector via the discovered form anchor — a
 * literal `'input'` would hit the first input ANYWHERE on the page,
 * which is non-deterministic on flip-card layouts (Amex / Isracard
 * SMS-form + password-form coresident). When no form anchor is
 * cached (config without an id-bearing form), we fall back to
 * `'input'` so the legacy Enter behaviour is preserved (CR PR #345
 * round-2 finding on {@link pressEnterOrFalse}; mirrors the
 * {@link tryClickSubmit} form-anchor chaining pattern).
 * @param frameCtx - Frame or Page where the form was filled.
 * @param formAnchor - Discovered form selector, empty when none.
 * @returns True only when Enter was successfully dispatched.
 */
async function pressEnterOrFalse(frameCtx: Page | Frame, formAnchor: string): Promise<boolean> {
  const selector = formAnchor ? `${formAnchor} input` : 'input';
  try {
    await frameCtx.press(selector, 'Enter');
    return true;
  } catch (error) {
    return handlePressReject(error);
  }
}

/**
 * Flat catch-handler for {@link pressEnterOrFalse} — keeps the
 * `catch` body at `max-depth: 1` (CR PR #345 round-2: project cap-10
 * forbids nested `if` inside `catch`).
 * @param error - Caught rejection from `frameCtx.press`.
 * @returns Literal `false` when {@link isBenignPressReject} matches.
 * @throws Original error when the rejection is non-benign.
 */
function handlePressReject(error: unknown): false {
  if (isBenignPressReject(error)) return false;
  throw error;
}

/**
 * Try pressing Enter in the frame context to submit the form.
 * Enter fires first (native form submit), Click fires second (Angular ng-click).
 * Both are safe — fillWithFrameworkDetection updates Angular model before either fires.
 * @param frameCtx - Page or Frame where fields were filled (false if none).
 * @param formAnchor - Discovered form selector, empty when none.
 * @param logger - Pipeline logger.
 * @returns True only when Enter actually dispatched (no false-positive on rejection).
 */
async function tryEnterSubmit(
  frameCtx: Page | Frame | false,
  formAnchor: string,
  logger: ScraperLogger,
): Promise<boolean> {
  if (!frameCtx || !('press' in frameCtx)) return false;
  logEnterAttempt(logger, frameCtx);
  return pressEnterOrFalse(frameCtx, formAnchor);
}

/**
 * Emit the masked `method=enter` debug line and return the masked
 * URL for callers that want it. Extracted from {@link tryEnterSubmit}
 * so the parent stays ≤cap-10 AND so the nested
 * `maskVisibleText(frameCtx.url())` call sits behind a named
 * intermediate (project lint forbids inline nested calls + bans
 * `void` return types; CR PR #345 round-2).
 * @param logger - Pipeline logger.
 * @param frameCtx - Frame or Page that holds the focused form.
 * @returns The PII-masked URL string that was logged.
 */
function logEnterAttempt(logger: ScraperLogger, frameCtx: Page | Frame): string {
  const rawUrl = frameCtx.url();
  const url = maskVisibleText(rawUrl);
  logger.debug({ method: 'enter', url });
  return url;
}

/**
 * Log a successful click and return `succeed(true)` for the chain.
 * Extracted from {@link tryClickSubmit} to keep that function ≤10 LoC.
 * @param logger - Pipeline logger.
 * @param value - The selector value that was clicked (will be masked).
 * @returns `succeed(true)` after logging.
 */
function logClickHit(logger: ScraperLogger, value: string): Procedure<boolean> {
  const masked = maskVisibleText(value);
  logger.debug({ method: 'click', url: masked });
  return succeed(true);
}

/**
 * Try clicking the submit button scoped to the discovered form.
 * @param args - Bundled submit-phase args (`mediator`, `config`, `logger`).
 * @returns Procedure succeed(true) if clicked, succeed(false) if not found, fail on error.
 */
async function tryClickSubmit(args: ISubmitPhaseArgs): Promise<Procedure<boolean>> {
  // Form-membership scoping via Locator chaining discriminates co-resident
  // submit buttons on flip-card pages (e.g. Amex/Isracard SMS-form vs password-form).
  const candidates = normalizeSubmit(args.config.submit);
  const formAnchor = args.mediator.getFormAnchor();
  const result = await args.mediator.resolveAndClick(candidates, undefined, formAnchor);
  if (!result.success) return result;
  if (!result.value.found) return succeed(false);
  return logClickHit(args.logger, result.value.value);
}

/**
 * Browser-side callback: call form.requestSubmit() when the element supports it.
 * Passed to Playwright locator.evaluate(); runs inside the browser context.
 * Returns whether a real submit fired so callers never treat a non-submit
 * element (requestSubmit absent) as a successful submit.
 * @param el - The matched form element.
 * @returns True when requestSubmit was invoked; false when it is unavailable.
 */
function doFormRequestSubmit(el: Element): boolean {
  interface IHasSubmit {
    requestSubmit?(): unknown;
  }
  const f = el as unknown as IHasSubmit;
  if (typeof f.requestSubmit !== 'function') return false;
  f.requestSubmit();
  return true;
}

/**
 * Invoke form.requestSubmit() on the discovered form anchor.
 * D3 diagnostic: test AngularJS native submit vs Enter+click.
 * Returns false without throwing when ctx is false or formAnchor is empty.
 * @internal — exported for unit-test access only.
 * @param ctx - Page or Frame, or false when no frame context is available.
 * @param formAnchor - CSS selector string for the form element.
 * @returns The evaluated submit outcome; false when ctx/anchor are missing,
 *   the element is not submit-capable, or evaluate rejects.
 */
export async function tryFormRequestSubmit(ctx: FormCtx, formAnchor: string): Promise<boolean> {
  if (!ctx || !formAnchor) return false;
  try {
    const locator = ctx.locator(formAnchor);
    return await locator.evaluate(doFormRequestSubmit);
  } catch {
    return false;
  }
}

/**
 * Submit using ONLY form.requestSubmit() (D3 'form' mode).
 * Skips Enter + click entirely; the click signal mirrors the real submit
 * outcome so gateNoSubmitSignal fails when no requestSubmit actually fired.
 * @param ctx - Page or Frame context for the form.
 * @param formAnchor - Discovered form anchor selector.
 * @returns ISubmitPhaseResult with didEnter=false, clickResult=succeed(outcome).
 */
async function runFormOnlySubmit(ctx: FormCtx, formAnchor: string): Promise<ISubmitPhaseResult> {
  const didSubmit = await tryFormRequestSubmit(ctx, formAnchor);
  return { didEnter: false, clickResult: succeed(didSubmit) };
}

/**
 * Run the submit attempts according to the active submit mode.
 * Default ('enter-click') is byte-identical to pre-D3 behaviour.
 * 'form' = requestSubmit only; 'all' = Enter + Click + requestSubmit.
 * @param args - Bundled submit-phase args.
 * @returns Bundle of `didEnter` + `clickResult`.
 */
async function runSubmitPhase(args: ISubmitPhaseArgs): Promise<ISubmitPhaseResult> {
  const formAnchor = args.mediator.getFormAnchor();
  const mode = readSubmitMode();
  if (mode === 'form') return runFormOnlySubmit(args.enterCtx, formAnchor);
  const didEnter = await tryEnterSubmit(args.enterCtx, formAnchor, args.logger);
  const clickResult = await tryClickSubmit(args);
  if (mode === 'all') await tryFormRequestSubmit(args.enterCtx, formAnchor);
  return { didEnter, clickResult };
}

/**
 * Resolve the fired method, log it, and return the success Procedure.
 * Extracted from {@link finalizeSubmit} for cap-10 conformance.
 * @param submit - Submit-phase bundle.
 * @param mediator - Element mediator (used for URL probe in log).
 * @param logger - Pipeline logger.
 * @returns `succeed({ success: true, method })`.
 */
function logAndSucceed(
  submit: ISubmitPhaseResult,
  mediator: IElementMediator,
  logger: ScraperLogger,
): Procedure<ISubmitResult> {
  const method = resolveSubmitFromPhase(submit);
  logSubmitResult(logger, mediator, method);
  return succeed({ success: true, method });
}

/**
 * Finalize the submit phase: gate phantom-success, resolve the
 * method that fired, and emit the post-submit debug line.
 * Extracted from {@link fillAndSubmit} to keep it ≤7 statements.
 * @param submit - Submit-phase bundle returned by `runSubmitPhase`.
 * @param mediator - Element mediator (used for URL probe in log).
 * @param logger - Pipeline logger.
 * @returns Procedure carrying the final ISubmitResult.
 */
function finalizeSubmit(
  submit: ISubmitPhaseResult,
  mediator: IElementMediator,
  logger: ScraperLogger,
): Procedure<ISubmitResult> {
  if (!submit.clickResult.success && !submit.didEnter) return submit.clickResult;
  const gate = gateNoSubmitSignal(submit);
  if (!gate.success) return gate;
  return logAndSucceed(submit, mediator, logger);
}

/**
 * Fill fields then submit — Enter first, then Click.
 * Returns which method fired so POST knows what to validate.
 * @param args - Bundled fill-and-submit arguments.
 * @returns Procedure with ISubmitResult (method: enter|click|both).
 */
export async function fillAndSubmit(args: IFillAndSubmitArgs): Promise<Procedure<ISubmitResult>> {
  const { mediator, config, creds, logger } = args;
  logFillCount(logger, config.fields.length);
  const fill = await fillAllFields({ mediator, fields: config.fields, creds, logger });
  if (!fill.procedure.success) return fill.procedure;
  const enterCtx = fill.frameContext ?? false;
  const submit = await runSubmitPhase({ mediator, config, enterCtx, logger });
  return finalizeSubmit(submit, mediator, logger);
}
