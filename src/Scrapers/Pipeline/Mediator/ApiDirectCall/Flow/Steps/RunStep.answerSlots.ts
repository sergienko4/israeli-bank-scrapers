/**
 * Answer slots — the carry slots a step reads off its answer itself rather
 * than off its JSON body: the response-header slots, the final URL,
 * the text captures, the login-form capture, then the
 * handoff script capture.
 */

import { ScraperErrorTypes } from '../../../../../Base/ErrorTypes.js';
import type { Procedure } from '../../../../Types/Procedure.js';
import { fail, isOk, succeed } from '../../../../Types/Procedure.js';
import { captureForm } from '../Captures/RunStep.formCapture.js';
import { captureLocation } from '../Captures/RunStep.locationCapture.js';
import { captureStructured } from '../Captures/RunStep.structuredCapture.js';
import { captureText } from '../Captures/RunStep.textCapture.js';
import { carryFinalUrl } from './RunStep.finalUrl.js';
import { carryHeaders } from './RunStep.headerCarry.js';
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
 * Accept the absolute answering URL for relative page captures.
 * @param bundle - The fired step and its response capture.
 * @returns The answering URL or a value-free failure.
 */
function captureUrlOf(bundle: IDispatchBundle): Procedure<string> {
  const text = bundle.fireArgs.headerCapture?.urls[0];
  const parsed = text === undefined ? null : URL.parse(text);
  if (parsed?.protocol === 'http:' || parsed?.protocol === 'https:') return succeed(parsed.href);
  return fail(ScraperErrorTypes.Generic, `${bundle.fireScope.step.name} answer url missing`);
}

/**
 * Capture the login form and handoff against the answering URL.
 * @param args - The step and its company.
 * @param resp - Successful response JSON.
 * @param url - Validated URL that answered the step.
 * @returns Page slots, or the first refusal.
 */
function readPageSlots(args: IRunStepArgs, resp: JsonValue, url: string): Procedure<CarryMap> {
  const form = captureForm(args, resp, url);
  if (!isOk(form)) return form;
  const location = captureLocation(args, resp, url);
  if (!isOk(location)) return location;
  const structured = captureStructured(args, resp, url);
  if (!isOk(structured)) return structured;
  return succeed({ ...form.value, ...location.value, ...structured.value });
}

/**
 * Whether the step requests a capture resolved against the answering URL.
 * @param args - The step and its configuration.
 * @returns True when page capture is configured.
 */
function hasPageCapture(args: IRunStepArgs): boolean {
  const { formCapture, locationCapture, structuredCapture } = args.step;
  if (formCapture !== undefined || locationCapture !== undefined) return true;
  return structuredCapture !== undefined && structuredCapture.kind !== 'jwt-claims';
}

/**
 * Capture page slots only for steps that request them.
 * @param bundle - The fired step and its response capture.
 * @param resp - Successful response JSON.
 * @returns Page slots, or a value-free failure.
 */
function pageSlots(bundle: IDispatchBundle, resp: JsonValue): Procedure<CarryMap> {
  const args = bundle.fireScope;
  if (!hasPageCapture(args)) return succeed({});
  const url = captureUrlOf(bundle);
  if (!isOk(url)) return url;
  return readPageSlots(args, resp, url.value);
}

/**
 * Read the slots a step captures off its text.
 * @param bundle - The fired step and its response capture.
 * @param resp - Successful response JSON.
 * @returns Text and page slots, or the first refusal.
 */
function textSlots(bundle: IDispatchBundle, resp: JsonValue): Procedure<CarryMap> {
  const captured = captureText(bundle.fireScope.step, resp);
  if (!isOk(captured)) return captured;
  const page = pageSlots(bundle, resp);
  if (!isOk(page)) return page;
  return succeed({ ...captured.value, ...page.value });
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
  const textProc = textSlots(bundle, resp);
  if (!isOk(textProc)) return textProc;
  return succeed({ ...responseProc.value, ...textProc.value });
}

export default answerSlots;
export { answerSlots };
