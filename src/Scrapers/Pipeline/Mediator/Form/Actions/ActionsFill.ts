/**
 * Classic fill path — resolve fields via mediator (universal anchor),
 * then submit via Enter + Click.
 *
 * <p>Phase 12d split: extracted from {@link ../LoginFormActions.ts}.
 */

import type { Frame, Page } from 'playwright-core';

import type { IFieldConfig } from '../../../../Base/Interfaces/Config/FieldConfig.js';
import type { ILoginConfig } from '../../../../Base/Interfaces/Config/LoginConfig.js';
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
 * Try pressing Enter in the frame context to submit the form.
 * Enter fires first (native form submit), Click fires second (Angular ng-click).
 * Both are safe — fillWithFrameworkDetection updates Angular model before either fires.
 * @param frameCtx - Page or Frame where fields were filled (false if none).
 * @param logger - Pipeline logger.
 * @returns True if Enter was pressed.
 */
async function tryEnterSubmit(
  frameCtx: Page | Frame | false,
  logger: ScraperLogger,
): Promise<boolean> {
  if (!frameCtx || !('press' in frameCtx)) return false;
  const url = frameCtx.url();
  logger.debug({ method: 'enter', url: maskVisibleText(url) });
  await frameCtx.press('input', 'Enter').catch((): false => false);
  return true;
}

/**
 * Try clicking the submit button scoped to the discovered form.
 * @param mediator - Element mediator.
 * @param config - Login config.
 * @param logger - Pipeline logger.
 * @returns Procedure succeed(true) if clicked, succeed(false) if not found, fail on error.
 */
async function tryClickSubmit(
  mediator: IElementMediator,
  config: ILoginConfig,
  logger: ScraperLogger,
): Promise<Procedure<boolean>> {
  const candidates = normalizeSubmit(config.submit);
  // Form-membership scoping via Locator chaining: ALL candidate kinds
  // (xpath, textContent, regex, ariaLabel, ...) are scoped to descendants
  // of the discovered form. Discriminates co-resident submit buttons on
  // flip-card pages (e.g. Amex/Isracard SMS-form vs password-form).
  const formAnchor = mediator.getFormAnchor();
  const result = await mediator.resolveAndClick(candidates, undefined, formAnchor);
  if (!result.success) return result;
  if (!result.value.found) return succeed(false);
  const masked = maskVisibleText(result.value.value);
  logger.debug({ method: 'click', url: masked });
  return succeed(true);
}

/**
 * Run the Enter + Click submit attempts in order.
 * Both fire so POST knows what to validate; the caller decides the outcome.
 * @param args - Bundled submit-phase args.
 * @returns Bundle of `didEnter` + `clickResult`.
 */
async function runSubmitPhase(args: ISubmitPhaseArgs): Promise<ISubmitPhaseResult> {
  const didEnter = await tryEnterSubmit(args.enterCtx, args.logger);
  const clickResult = await tryClickSubmit(args.mediator, args.config, args.logger);
  return { didEnter, clickResult };
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
  const fillResult = await fillAllFields({ mediator, fields: config.fields, creds, logger });
  if (!fillResult.procedure.success) return fillResult.procedure;
  const enterCtx = fillResult.frameContext ?? false;
  const submit = await runSubmitPhase({ mediator, config, enterCtx, logger });
  if (!submit.clickResult.success && !submit.didEnter) return submit.clickResult;
  const gate = gateNoSubmitSignal(submit);
  if (!gate.success) return gate;
  const method = resolveSubmitFromPhase(submit);
  logSubmitResult(logger, mediator, method);
  return succeed({ success: true, method });
}
