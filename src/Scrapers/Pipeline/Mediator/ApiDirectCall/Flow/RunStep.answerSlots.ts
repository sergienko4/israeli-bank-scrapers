/**
 * Answer slots — the carry slots a step reads off its answer itself rather
 * than off its JSON body: the response-header slots (N6), the final URL
 * (N51), the text captures (N36), the login-form capture (N37), then the
 * handoff script capture (N54).
 */

import type { Procedure } from '../../../Types/Procedure.js';
import { isOk, succeed } from '../../../Types/Procedure.js';
import { carryFinalUrl } from './RunStep.finalUrl.js';
import { captureForm } from './RunStep.formCapture.js';
import { carryHeaders } from './RunStep.headerCarry.js';
import { captureLocation } from './RunStep.locationCapture.js';
import { captureText } from './RunStep.textCapture.js';
import type { CarryMap, IDispatchBundle, IRunStepArgs, JsonValue } from './RunStep.types.js';

/**
 * Read the slots the response itself carries: its headers, then its final URL.
 * @param bundle - Dispatch bundle.
 * @returns Procedure with those slots, or the first missing or refused one.
 */
function responseSlots(bundle: IDispatchBundle): Procedure<CarryMap> {
  const headerProc = carryHeaders(bundle);
  if (!isOk(headerProc)) return headerProc;
  const finalProc = carryFinalUrl(bundle);
  if (!isOk(finalProc)) return finalProc;
  return succeed({ ...headerProc.value, ...finalProc.value });
}

/**
 * Read the slots a step captures off its text: the text captures, the login
 * form, then the handoff script's URL.
 * @param args - The step and its company.
 * @param resp - Successful response JSON.
 * @returns Procedure with those slots, or the first missing or refused one.
 */
function textSlots(args: IRunStepArgs, resp: JsonValue): Procedure<CarryMap> {
  const captured = captureText(args.step, resp);
  if (!isOk(captured)) return captured;
  const form = captureForm(args, resp);
  if (!isOk(form)) return form;
  const location = captureLocation(args, resp);
  if (!isOk(location)) return location;
  return succeed({ ...captured.value, ...form.value, ...location.value });
}

/**
 * Read the slots a step's answer itself carries: the response slots, then
 * the text slots.
 * @param bundle - Dispatch bundle.
 * @param resp - Successful response JSON.
 * @returns Procedure with those slots, or the first missing or refused one.
 */
function answerSlots(bundle: IDispatchBundle, resp: JsonValue): Procedure<CarryMap> {
  const responseProc = responseSlots(bundle);
  if (!isOk(responseProc)) return responseProc;
  const textProc = textSlots(bundle.fireScope, resp);
  if (!isOk(textProc)) return textProc;
  return succeed({ ...responseProc.value, ...textProc.value });
}

export default answerSlots;
export { answerSlots };
