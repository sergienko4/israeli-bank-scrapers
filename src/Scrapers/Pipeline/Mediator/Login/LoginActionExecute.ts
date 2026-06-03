/**
 * LOGIN ACTION executor — sealed fill+submit from PRE discovery.
 *
 * <p>Phase 2d strict-cluster split: extracted from
 * {@link ./LoginPhaseActions.ts}.
 */

import { ScraperErrorTypes } from '../../../Base/ErrorTypes.js';
import type { ILoginConfig } from '../../../Base/Interfaces/Config/LoginConfig.js';
import { type IActionContext, type ILoginFieldDiscovery } from '../../Types/PipelineContext.js';
import type { IProcedureFailure, Procedure } from '../../Types/Procedure.js';
import { fail, succeed } from '../../Types/Procedure.js';
import type { IActionMediator } from '../Elements/ElementMediator.js';
import { fillFromDiscovery, type SubmitMethod } from '../Form/LoginFormActions.js';

/** Failure messages for the LOGIN ACTION early gates. */
const LOGIN_ACTION_NO_DISCOVERY = 'LOGIN ACTION: no field discovery';
const LOGIN_ACTION_NO_EXECUTOR = 'LOGIN ACTION: no executor';

/** Outcome of {@link gateActionInputs}. */
type ActionInputsGate =
  | {
      readonly tag: 'ok';
      readonly discovery: ILoginFieldDiscovery;
      readonly executor: IActionMediator;
    }
  | { readonly tag: 'fail'; readonly proc: IProcedureFailure };

/**
 * Gate the LOGIN ACTION inputs (discovery + executor).
 * @param input - Sealed ACTION context.
 * @returns Tagged result.
 */
function gateActionInputs(input: IActionContext): ActionInputsGate {
  if (!input.loginFieldDiscovery.has) {
    return { tag: 'fail', proc: fail(ScraperErrorTypes.Generic, LOGIN_ACTION_NO_DISCOVERY) };
  }
  if (!input.executor.has) {
    return { tag: 'fail', proc: fail(ScraperErrorTypes.Generic, LOGIN_ACTION_NO_EXECUTOR) };
  }
  return { tag: 'ok', discovery: input.loginFieldDiscovery.value, executor: input.executor.value };
}

/** Bundled args for {@link runFillFromDiscovery}. */
interface IRunFillArgs {
  readonly config: ILoginConfig;
  readonly input: IActionContext;
  readonly discovery: ILoginFieldDiscovery;
  readonly executor: IActionMediator;
}

/**
 * Build the args bundle for `fillFromDiscovery`.
 * @param args - Run-fill bundle.
 * @returns Fill-from-discovery args.
 */
function buildFillArgs(args: IRunFillArgs): Parameters<typeof fillFromDiscovery>[0] {
  const creds = args.input.credentials as Record<string, string>;
  return {
    discovery: args.discovery,
    executor: args.executor,
    config: args.config,
    creds,
    logger: args.input.logger,
  };
}

/**
 * Run the sealed fill+submit executor against the PRE-resolved discovery.
 * @param args - Bundled fill arguments.
 * @returns Fill outcome from `fillFromDiscovery`.
 */
async function runFillFromDiscovery(
  args: IRunFillArgs,
): Promise<Awaited<ReturnType<typeof fillFromDiscovery>>> {
  const fillArgs = buildFillArgs(args);
  return fillFromDiscovery(fillArgs);
}

/** Bundle returned by {@link gateActionInputs} on success. */
interface IGateOk {
  readonly discovery: ILoginFieldDiscovery;
  readonly executor: IActionMediator;
}

/**
 * Run fill+commit on the post-gate inputs.
 * @param config - Login config.
 * @param input - Action context.
 * @param gate - Gate-OK bundle (discovery + executor).
 * @param gate.discovery - Login field discovery from the gate.
 * @param gate.executor - Action mediator from the gate.
 * @returns Resolved Procedure.
 */
async function runFillAfterGate(
  config: ILoginConfig,
  input: IActionContext,
  { discovery, executor }: IGateOk,
): Promise<Procedure<IActionContext>> {
  const fillArgs: IRunFillArgs = { config, input, discovery, executor };
  const result = await runFillFromDiscovery(fillArgs);
  if (!result.success) return result;
  return commitFillResult(input, result.value.method);
}

/**
 * Commit the action-context with the resolved submit method.
 * @param input - Action context to extend.
 * @param method - Submit method captured by the fill result.
 * @returns Success procedure with extended diagnostics.
 */
function commitFillResult(input: IActionContext, method: SubmitMethod): Procedure<IActionContext> {
  const diag = { ...input.diagnostics, submitMethod: method };
  return succeed({ ...input, diagnostics: diag });
}

/**
 * ACTION: Fill fields from PRE discovery + submit via sealed executor.
 * @param config - Login config with submit candidates.
 * @param input - Sealed action context.
 * @returns Updated context with submitMethod in diagnostics.
 */
async function executeFillAndSubmitFromDiscovery(
  config: ILoginConfig,
  input: IActionContext,
): Promise<Procedure<IActionContext>> {
  const gate = gateActionInputs(input);
  if (gate.tag === 'fail') return gate.proc;
  return runFillAfterGate(config, input, gate);
}

export default executeFillAndSubmitFromDiscovery;
export { executeFillAndSubmitFromDiscovery };
