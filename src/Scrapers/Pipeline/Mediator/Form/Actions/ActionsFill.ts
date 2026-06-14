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
 * Press Enter via the frame; return `false` when Playwright rejects.
 * Extracted from {@link tryEnterSubmit} so a rejected `press()` no
 * longer falsely signals success (CR PR #345 finding #167).
 * @param frameCtx - Frame or Page where the form was filled.
 * @returns True only when Enter was successfully dispatched.
 */
async function pressEnterOrFalse(frameCtx: Page | Frame): Promise<boolean> {
  try {
    await frameCtx.press('input', 'Enter');
    return true;
  } catch {
    return false;
  }
}

/**
 * Try pressing Enter in the frame context to submit the form.
 * Enter fires first (native form submit), Click fires second (Angular ng-click).
 * Both are safe — fillWithFrameworkDetection updates Angular model before either fires.
 * @param frameCtx - Page or Frame where fields were filled (false if none).
 * @param logger - Pipeline logger.
 * @returns True only when Enter actually dispatched (no false-positive on rejection).
 */
async function tryEnterSubmit(
  frameCtx: Page | Frame | false,
  logger: ScraperLogger,
): Promise<boolean> {
  if (!frameCtx || !('press' in frameCtx)) return false;
  const rawUrl = frameCtx.url();
  const url = maskVisibleText(rawUrl);
  logger.debug({ method: 'enter', url });
  return pressEnterOrFalse(frameCtx);
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
 * Run the Enter + Click submit attempts in order.
 * Both fire so POST knows what to validate; the caller decides the outcome.
 * @param args - Bundled submit-phase args.
 * @returns Bundle of `didEnter` + `clickResult`.
 */
async function runSubmitPhase(args: ISubmitPhaseArgs): Promise<ISubmitPhaseResult> {
  const didEnter = await tryEnterSubmit(args.enterCtx, args.logger);
  const clickResult = await tryClickSubmit(args);
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
