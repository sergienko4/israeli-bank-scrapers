/**
 * runSmsOtpFlow — the top-level entry point.
 */

import type { Procedure } from '../../../Types/Procedure.js';
import { isOk, succeed } from '../../../Types/Procedure.js';
import { prepareSmsOtpFlow } from './SmsOtpFlow.prep.js';
import { buildFlowResult, extractTokenFromCarry, reduceAllSteps } from './SmsOtpFlow.result.js';
import type { IFlowResult, IRunSmsOtpArgs } from './SmsOtpFlow.types.js';

/**
 * Run the sms-otp flow end-to-end.
 * @param args - Run args.
 * @returns Procedure with { bearer, longTermToken, carrySnapshot }.
 */
async function runSmsOtpFlow(args: IRunSmsOtpArgs): Promise<Procedure<IFlowResult>> {
  const prepProc = prepareSmsOtpFlow(args);
  if (!isOk(prepProc)) return prepProc;
  const finalProc = await reduceAllSteps(args, prepProc.value);
  if (!isOk(finalProc)) return finalProc;
  const bearerProc = extractTokenFromCarry(finalProc.value);
  if (!isOk(bearerProc)) return bearerProc;
  const result = buildFlowResult(finalProc.value, args.config, bearerProc.value);
  return succeed(result);
}

export default runSmsOtpFlow;

export { runSmsOtpFlow };
