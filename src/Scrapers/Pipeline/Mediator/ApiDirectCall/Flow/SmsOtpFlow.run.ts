/**
 * runSmsOtpFlow — the top-level entry point.
 */

import type { Procedure } from '../../../Types/Procedure.js';
import { isOk } from '../../../Types/Procedure.js';
import { prepareSmsOtpFlow } from './SmsOtpFlow.prep.js';
import { buildFlowResult, reduceAllSteps } from './SmsOtpFlow.result.js';
import type { IFlowResult, IRunSmsOtpArgs } from './SmsOtpFlow.types.js';

/**
 * Run the sms-otp flow end-to-end. Callers may inject the keys to sign with
 * and a replacement step list; both default to the configured behaviour.
 * @param args - Run args.
 * @returns Procedure with { bearer, longTermToken, carrySnapshot, keypairs }.
 */
async function runSmsOtpFlow(args: IRunSmsOtpArgs): Promise<Procedure<IFlowResult>> {
  const prepProc = prepareSmsOtpFlow(args);
  if (!isOk(prepProc)) return prepProc;
  const finalProc = await reduceAllSteps(args, prepProc.value);
  if (!isOk(finalProc)) return finalProc;
  return buildFlowResult(finalProc.value, args.config, prepProc.value.keypairs);
}

export default runSmsOtpFlow;

export { runSmsOtpFlow };
