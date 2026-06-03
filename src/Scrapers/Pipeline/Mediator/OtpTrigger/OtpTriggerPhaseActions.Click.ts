/**
 * OTP-TRIGGER ACTION (sealed) — clicks the resolved trigger target,
 * stamps the click deadline, and waits for network idle.
 */

import { ScraperErrorTypes } from '../../../Base/ErrorTypes.js';
import type {
  IActionContext,
  IPipelineContext,
  IResolvedTarget,
} from '../../Types/PipelineContext.js';
import type { Procedure } from '../../Types/Procedure.js';
import { fail, succeed } from '../../Types/Procedure.js';
import type { IActionMediator } from '../Elements/ElementMediator.js';
import { readDiagTarget } from '../Otp/OtpShared.js';
import { OTP_PHASE_SETTLE_TIMEOUT_MS } from '../Timing/TimingConfig.js';

/** Bundled args for {@link clickOtpTrigger}. */
interface IClickTriggerArgs {
  readonly executor: IActionMediator;
  readonly target: IResolvedTarget;
  readonly logger: IPipelineContext['logger'];
}

/**
 * Click the resolved OTP-trigger target and log the outcome.
 * @param args - Bundle of executor, click target, pipeline logger.
 * @returns True iff the click resolved without rejecting.
 */
async function clickOtpTrigger(args: IClickTriggerArgs): Promise<boolean> {
  const { executor, target, logger } = args;
  const didClick = await executor
    .clickElement({ contextId: target.contextId, selector: target.selector })
    .then((): true => true)
    .catch((): false => false);
  logger.debug({ message: `trigger-otp: ${String(didClick)} @ ${target.contextId}` });
  return didClick;
}

/**
 * Stamp click deadline IMMEDIATELY AFTER the click succeeds, BEFORE
 * the network-idle settle wait.
 * @param executor - Sealed action mediator.
 * @returns Epoch-ms captured BEFORE the settle wait begins.
 */
async function captureClickedAtAndSettle(executor: IActionMediator): Promise<number> {
  const triggerClickedAt = Date.now();
  await executor.waitForNetworkIdle(OTP_PHASE_SETTLE_TIMEOUT_MS).catch((): false => false);
  return triggerClickedAt;
}

/** Action procedure alias keeping single-line signatures. */
type ActionProc = Procedure<IActionContext>;

/**
 * Perform the actual trigger click, capture the click deadline, and
 * stamp `triggerClickedAt` into diagnostics.
 * @param input - Sealed action context.
 * @param args - Bundle of executor, target, and pipeline logger.
 * @returns Updated context on click success, failure on click reject.
 */
async function performTriggerClickAndStamp(
  input: IActionContext,
  args: IClickTriggerArgs,
): Promise<ActionProc> {
  const didClick = await clickOtpTrigger(args);
  if (!didClick) return fail(ScraperErrorTypes.Generic, 'OTP trigger failed — SMS not sent');
  const triggerClickedAt = await captureClickedAtAndSettle(args.executor);
  const diag = { ...input.diagnostics, triggerClickedAt };
  return succeed({ ...input, diagnostics: diag });
}

/**
 * ACTION (sealed): Click the OTP trigger button.
 * Hand follows Eye — uses exact contextId + selector from PRE.
 * @param input - Sealed action context.
 * @returns Updated context or failure.
 */
async function executeTriggerAction(input: IActionContext): Promise<ActionProc> {
  if (!input.executor.has) return succeed(input);
  const executor = input.executor.value;
  const target = readDiagTarget(input.diagnostics, 'otpTriggerTarget');
  if (!target) return fail(ScraperErrorTypes.Generic, 'OTP trigger — no target from PRE');
  return performTriggerClickAndStamp(input, { executor, target, logger: input.logger });
}

export default executeTriggerAction;
