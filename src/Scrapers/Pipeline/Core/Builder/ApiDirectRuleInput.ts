/**
 * What the api-direct build-time rules read, the shape of one rule, and the
 * step walk they share. Kept apart so every rule module imports it without
 * importing the validator that runs them.
 */

import type {
  IApiDirectCallConfig,
  IStepConfig,
} from '../../Mediator/ApiDirectCall/ConfigContracts/index.js';
import type { IHeadlessUrlsConfig } from '../../Registry/Config/PipelineBankConfigTypes.js';

/** What the rules read: the call config and the bank's headless block. */
interface IApiDirectRuleInput {
  readonly call: IApiDirectCallConfig;
  readonly headless: IHeadlessUrlsConfig | false;
}

/** One rule: the failure text and the check that finds it broken. */
interface IApiDirectRule {
  readonly message: string;
  readonly isBroken: (input: IApiDirectRuleInput) => boolean;
}

/**
 * Every login step, including durable resume steps.
 * @param call - Call config.
 * @returns All steps the config can run.
 */
function allSteps(call: IApiDirectCallConfig): readonly IStepConfig[] {
  const resume = call.persistentAuth?.resumeSteps ?? [];
  return [...call.steps, ...resume];
}

export type { IApiDirectRule, IApiDirectRuleInput };
export { allSteps };
