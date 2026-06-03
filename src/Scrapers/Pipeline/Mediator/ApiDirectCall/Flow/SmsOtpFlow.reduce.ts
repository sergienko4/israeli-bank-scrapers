/**
 * Step-reduction helpers: per-step hook resolution + runStep invocation.
 */

import type { Procedure } from '../../../Types/Procedure.js';
import { isOk, succeed } from '../../../Types/Procedure.js';
import type { IApiDirectCallConfig } from '../IApiDirectCallConfig.js';
import type { ITemplateScope } from '../Template/RefResolver.js';
import { runStep } from './RunStep.js';
import { applyPreHook } from './SmsOtpFlow.prehook.js';
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
  return applyPreHook({ scope, creds: args.creds, hook: step.preHook });
}

/**
 * Build the runStep payload for the current iteration.
 * @param bundle - Step + reduce-args + scope bundle.
 * @returns runStep input bundle.
 */
function makeRunStepArgs(bundle: IMakeRunStepArgs): Parameters<typeof runStep>[0] {
  return {
    step: bundle.step,
    bus: bundle.args.bus,
    scope: bundle.scope,
    companyId: bundle.args.companyId,
    signingKeypair: bundle.args.keypair,
    cookieJar: bundle.args.cookieJar,
  };
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
  const next = await runOneStep(args.reduceArgs, acc.value, args.steps[index]);
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
