/**
 * The device certificate of one step. A step naming `clientCert`
 * resolves its key and certificate refs and installs the pair through the
 * bus's certificate port before its request, so that request and every later
 * one to the bank origin present it. A refused pair keeps the certificate
 * already installed. A failure names the step only, never the PEM text.
 */

import { ScraperErrorTypes } from '../../../../../Base/ErrorTypes.js';
import type {
  IClientCertControl,
  IClientCertPair,
} from '../../../../Types/Domain/ClientCertControl.js';
import type { IProcedureFailure, Procedure } from '../../../../Types/Procedure.js';
import { fail, isOk, succeed } from '../../../../Types/Procedure.js';
import type { IStepClientCert } from '../../ConfigContracts/index.js';
import { type ITemplateScope, resolveRefText } from '../../Template/RefResolver.js';
import type { IRunStepArgs, IStepConfig } from '../Steps/RunStep.types.js';

const UNSUPPORTED = 'client certificate unsupported';
const INVALID = 'client certificate invalid';

/**
 * A step failure that names the step and the reason only.
 * @param step - Step config.
 * @param reason - Failure reason.
 * @returns Generic failure.
 */
function refusal(step: IStepConfig, reason: string): IProcedureFailure {
  return fail(ScraperErrorTypes.Generic, `${step.name} ${reason}`);
}

/**
 * Resolve the step's key and certificate refs.
 * @param refs - The step's certificate refs.
 * @param scope - Step scope.
 * @returns The pair, or false when either ref is unresolved or not text.
 */
function pairOf(refs: IStepClientCert, scope: ITemplateScope): IClientCertPair | false {
  const key = resolveRefText(refs.key, scope);
  const cert = resolveRefText(refs.cert, scope);
  if (key === false || cert === false) return false;
  return { key, cert };
}

/**
 * Resolve the step's pair and install it through the port.
 * @param control - The bus's certificate port.
 * @param refs - The step's certificate refs.
 * @param scope - Step scope.
 * @returns True once the port holds the pair; false when it was refused.
 */
function isInstalled(
  control: IClientCertControl,
  refs: IStepClientCert,
  scope: ITemplateScope,
): boolean {
  const pair = pairOf(refs, scope);
  if (pair === false) return false;
  const installed = control.install(pair);
  return isOk(installed);
}

/**
 * Install a step's device certificate before its request.
 * @param args - Run-step args.
 * @returns The args unchanged, or a failure naming the step.
 */
function installStepCert(args: IRunStepArgs): Procedure<IRunStepArgs> {
  const refs = args.step.clientCert;
  if (refs === undefined) return succeed(args);
  const control = args.bus.clientCert;
  if (control === undefined) return refusal(args.step, UNSUPPORTED);
  const wasInstalled = isInstalled(control, refs, args.scope);
  if (!wasInstalled) return refusal(args.step, INVALID);
  return succeed(args);
}

export default installStepCert;
export { installStepCert };
