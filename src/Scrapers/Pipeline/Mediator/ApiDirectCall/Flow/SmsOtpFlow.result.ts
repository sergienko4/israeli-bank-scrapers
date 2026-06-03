/**
 * Post-flow extraction helpers: bearer/long-term-token from carry,
 * seed/reduce args construction, and final IFlowResult assembly.
 */

import { ScraperErrorTypes } from '../../../../Base/ErrorTypes.js';
import type { Procedure } from '../../../Types/Procedure.js';
import { fail, succeed } from '../../../Types/Procedure.js';
import type { JsonValue } from '../Envelope/JsonPointer.js';
import type { IApiDirectCallConfig } from '../IApiDirectCallConfig.js';
import type { ITemplateScope } from '../Template/RefResolver.js';
import { createSimpleCookieJar } from './RunStep.js';
import { seedScope } from './SmsOtpFlow.prep.js';
import { reduceSteps } from './SmsOtpFlow.reduce.js';
import type {
  IFlowResult,
  IMakeReduceStepsArgs,
  IReduceStepsArgs,
  IRunSmsOtpArgs,
  ISeedArgs,
  ISmsOtpPrep,
  IStepReduceArgs,
} from './SmsOtpFlow.types.js';

/**
 * Extract the bearer token string from the final scope's carry.
 * @param scope - Final scope.
 * @returns Procedure with the bearer token value.
 */
function extractTokenFromCarry(scope: ITemplateScope): Procedure<string> {
  const token: JsonValue | false = scope.carry.token ?? false;
  if (typeof token !== 'string' || token.length === 0) {
    return fail(ScraperErrorTypes.Generic, 'sms-otp flow produced no carry.token');
  }
  return succeed(token);
}

/**
 * Read the long-term token from the final carry per config.warmStart.
 * @param config - API-direct-call config.
 * @param scope - Final scope.
 * @returns Long-term token or ''.
 */
function extractLongTermTokenFromCarry(
  config: IApiDirectCallConfig,
  scope: ITemplateScope,
): string {
  const warm = config.warmStart;
  if (warm === undefined) return '';
  const value = scope.carry[warm.carryField];
  if (typeof value !== 'string') return '';
  return value;
}

/**
 * Build the ISeedArgs payload from flow args + prep.
 * @param args - Flow run args.
 * @param prep - Prepared inputs.
 * @returns Seed args.
 */
function makeSeedArgs(args: IRunSmsOtpArgs, prep: ISmsOtpPrep): ISeedArgs {
  return {
    config: args.config,
    creds: args.creds,
    keypairs: prep.keypairs,
    fingerprint: prep.fingerprint,
    initialCarry: prep.initialCarry,
  };
}

/**
 * Build the IStepReduceArgs payload from flow args + prep.
 * @param args - Flow run args.
 * @param prep - Prepared inputs.
 * @returns Step-reduce args.
 */
function buildReduceArgs(args: IRunSmsOtpArgs, prep: ISmsOtpPrep): IStepReduceArgs {
  return {
    bus: args.bus,
    companyId: args.companyId,
    keypair: prep.keypairs.ec,
    creds: args.creds,
    cookieJar: createSimpleCookieJar(),
  };
}

/**
 * Build the IReduceStepsArgs payload.
 * @param bundle - Flow args + reduce args + seed scope bundle.
 * @returns Reduce-steps args.
 */
function makeReduceStepsArgs(bundle: IMakeReduceStepsArgs): IReduceStepsArgs {
  return {
    steps: bundle.args.config.steps,
    startIndex: bundle.args.startStepIndex ?? 0,
    reduceArgs: bundle.reduceArgs,
    initial: bundle.initial,
  };
}

/**
 * Drive the full step reduction (seed → reduceArgs → reduce).
 * @param args - Flow run args.
 * @param prep - Prepared inputs.
 * @returns Final scope procedure.
 */
async function reduceAllSteps(
  args: IRunSmsOtpArgs,
  prep: ISmsOtpPrep,
): Promise<Procedure<ITemplateScope>> {
  const seedArgs = makeSeedArgs(args, prep);
  const initial = seedScope(seedArgs);
  const reduceArgs = buildReduceArgs(args, prep);
  const reduceStepsArgs = makeReduceStepsArgs({ args, reduceArgs, initial });
  return reduceSteps(reduceStepsArgs);
}

/**
 * Build the final IFlowResult after step reduction.
 * @param scope - Final scope.
 * @param config - Bank config.
 * @param bearer - Extracted bearer token.
 * @returns Flow result bundle.
 */
function buildFlowResult(
  scope: ITemplateScope,
  config: IApiDirectCallConfig,
  bearer: string,
): IFlowResult {
  const longTermToken = extractLongTermTokenFromCarry(config, scope);
  const carrySnapshot = Object.freeze({ ...scope.carry });
  return { bearer, longTermToken, carrySnapshot };
}

export { buildFlowResult, extractLongTermTokenFromCarry, extractTokenFromCarry, reduceAllSteps };
