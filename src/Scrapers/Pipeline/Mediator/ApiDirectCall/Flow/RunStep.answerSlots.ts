/**
 * Answer slots — the carry slots a step reads off its answer itself rather
 * than off its JSON body: the response-header slots (N6), then the text
 * captures (N36).
 */

import type { Procedure } from '../../../Types/Procedure.js';
import { isOk, succeed } from '../../../Types/Procedure.js';
import { carryHeaders } from './RunStep.headerCarry.js';
import { captureText } from './RunStep.textCapture.js';
import type { CarryMap, IDispatchBundle, JsonValue } from './RunStep.types.js';

/**
 * Read the slots a step's answer itself carries: the response-header slots,
 * then the text captures.
 * @param bundle - Dispatch bundle.
 * @param resp - Successful response JSON.
 * @returns Procedure with those slots, or the first missing or refused one.
 */
function answerSlots(bundle: IDispatchBundle, resp: JsonValue): Procedure<CarryMap> {
  const headerProc = carryHeaders(bundle);
  if (!isOk(headerProc)) return headerProc;
  const captured = captureText(bundle.fireScope.step, resp);
  if (!isOk(captured)) return captured;
  return succeed({ ...headerProc.value, ...captured.value });
}

export default answerSlots;
export { answerSlots };
