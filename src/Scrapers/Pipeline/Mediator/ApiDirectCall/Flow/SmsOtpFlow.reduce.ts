/**
 * Step-reduction helpers: per-step hook resolution + runStep invocation.
 */

import type { Procedure } from '../../../Types/Procedure.js';
import { isOk, succeed } from '../../../Types/Procedure.js';
import type { IApiDirectCallConfig } from '../ConfigContracts/index.js';
import type { ITemplateScope } from '../Template/RefResolver.js';
import type { IRunStepArgs } from './RunStep.js';
import { runStep } from './RunStep.js';
import { applyPreHook } from './SmsOtpFlow.prehook.js';
import { isStepSkipped } from './SmsOtpFlow.runIf.js';
import type { IMakeRunStepArgs, IReduceStepsArgs, IStepReduceArgs } from './SmsOtpFlow.types.js';

/**
 * Resolve the scope to use for a step — applies preHook when present.
 * @param args - Reduce args.
 * @param scope - Current scope.
 * @param step - Next step config.
 * @returns Updated scope procedure.
 */
async function resolveStepScope(
  args: IStepReduceArgs,
  scope: ITemplateScope,
  step: IApiDirectCallConfig['steps'][number],
): Promise<Procedure<ITemplateScope>> {
  if (step.preHook === undefined) return succeed(scope);
  const hook = step.preHook;
  return applyPreHook({ scope, creds: args.creds, hook, cache: args.preHookCache });
}

/**
 * The flow-wide fields every step's runStep payload repeats.
 * @param args - Reduce args.
 * @returns Bus, bank, signing key, cookie jar and bank-text opt-out.
 */
function stepSession(args: IStepReduceArgs): Omit<IRunStepArgs, 'step' | 'scope'> {
  return {
    bus: args.bus,
    companyId: args.companyId,
    signingKeypair: args.keypair,
    cookieJar: args.cookieJar,
    isBankTextOmitted: args.isBankTextOmitted,
  };
}

/**
 * Build the runStep payload for the current iteration.
 * @param bundle - Step + reduce-args + scope bundle.
 * @returns runStep input bundle.
 */
function makeRunStepArgs(bundle: IMakeRunStepArgs): IRunStepArgs {
  const session = stepSession(bundle.args);
  return { ...session, step: bundle.step, scope: bundle.scope };
}

/**
 * Run preHook (if any) then runStep.
 * @param args - Reduce args.
 * @param scope - Current scope.
 * @param step - Next step config.
 * @returns Updated scope procedure.
 */
async function runOneStep(
  args: IStepReduceArgs,
  scope: ITemplateScope,
  step: IApiDirectCallConfig['steps'][number],
): Promise<Procedure<ITemplateScope>> {
  const hooked = await resolveStepScope(args, scope, step);
  if (!isOk(hooked)) return hooked;
  const stepArgs = makeRunStepArgs({ args, step, scope: hooked.value });
  return runStep(stepArgs);
}

/**
 * Run a step unless its `runIf` guard skips it; a skipped step and its
 * pre-hook never run, and the scope passes on unchanged.
 * @param args - Reduce args.
 * @param scope - Current scope.
 * @param step - Next step config.
 * @returns Updated scope procedure.
 */
async function runGuardedStep(
  args: IStepReduceArgs,
  scope: ITemplateScope,
  step: IApiDirectCallConfig['steps'][number],
): Promise<Procedure<ITemplateScope>> {
  if (isStepSkipped(step, scope)) return succeed(scope);
  return runOneStep(args, scope, step);
}

/**
 * Reduce every step sequentially starting from startIndex.
 * @param args - Reducer args bundle.
 * @param index - Current iteration index (pass startIndex to begin).
 * @param acc - Accumulated procedure (pass succeed(initial)).
 * @returns Final scope procedure (or first-failure short-circuit).
 */
async function reduceStepsAt(
  args: IReduceStepsArgs,
  index: number,
  acc: Procedure<ITemplateScope>,
): Promise<Procedure<ITemplateScope>> {
  if (!isOk(acc)) return acc;
  if (index >= args.steps.length) return acc;
  const next = await runGuardedStep(args.reduceArgs, acc.value, args.steps[index]);
  return reduceStepsAt(args, index + 1, next);
}

/**
 * Reduce every step sequentially starting from startIndex.
 * @param args - Reducer args bundle.
 * @returns Final scope procedure (or first-failure short-circuit).
 */
function reduceSteps(args: IReduceStepsArgs): Promise<Procedure<ITemplateScope>> {
  const seed: Procedure<ITemplateScope> = succeed(args.initial);
  return reduceStepsAt(args, args.startIndex, seed);
}

export default reduceSteps;

export { reduceSteps };
