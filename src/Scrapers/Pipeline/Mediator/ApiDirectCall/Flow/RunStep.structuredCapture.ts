/**
 * Reads an explicitly configured structured capture from a text answer.
 */

import { ScraperErrorTypes } from '../../../../Base/ErrorTypes.js';
import type { Procedure } from '../../../Types/Procedure.js';
import { fail, isOk, succeed } from '../../../Types/Procedure.js';
import type { IStepConfig, StructuredCapture } from '../ConfigContracts/index.js';
import { captureScriptJson } from '../Parsing/ScriptJsonCapture.js';
import { captureSdkReference } from '../Parsing/SdkReference.js';
import { answerText } from './RunStep.textCapture.js';
import type { CarryMap, IRunStepArgs, JsonValue } from './RunStep.types.js';

/** Captures read from an HTML answer. */
type PageCapture = Exclude<StructuredCapture, { kind: 'jwt-claims' }>;

/**
 * Lists keys from a configured slot map.
 * @param value - Untrusted slot map.
 * @returns Named slots, or none for an invalid map.
 */
function slotsOfMap(value: unknown): readonly string[] {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return [];
  return Object.keys(value);
}

/**
 * Lists structured output slots, tolerating malformed build input.
 * @param step - Step configuration.
 * @returns Named output slots.
 */
function structuredSlotsOf(step: IStepConfig): readonly string[] {
  const capture: unknown = step.structuredCapture;
  if (typeof capture !== 'object' || capture === null) return [];
  const kind: unknown = Reflect.get(capture, 'kind');
  const into: unknown = Reflect.get(capture, 'into');
  if (kind !== 'jwt-claims') return typeof into === 'string' ? [into] : [];
  const slots: unknown = Reflect.get(capture, 'captures');
  return slotsOfMap(slots);
}

/**
 * Captures a checked SDK reference from page text.
 * @param capture - Structured SDK capture configuration.
 * @param html - Successful response text.
 * @param answerUrl - Actual answering URL.
 * @returns Checked URL, or a value-free refusal.
 */
function captureSdk(capture: PageCapture, html: string, answerUrl: string): Procedure<string> {
  if (capture.kind !== 'sdk-reference') return fail(ScraperErrorTypes.Generic, 'capture invalid');
  return captureSdkReference({ html, answerUrl, rules: capture.url });
}

/**
 * Captures a configured root JSON field.
 * @param capture - Structured JSON capture configuration.
 * @param html - Successful response text.
 * @returns Checked value, or a value-free refusal.
 */
function captureJson(capture: PageCapture, html: string): Procedure<string> {
  if (capture.kind !== 'script-json') return fail(ScraperErrorTypes.Generic, 'capture invalid');
  return captureScriptJson({ ...capture, html });
}

/** Parser per structured capture kind. */
const CAPTURES: Readonly<
  Record<
    PageCapture['kind'],
    (capture: PageCapture, html: string, answerUrl: string) => Procedure<string>
  >
> = { 'sdk-reference': captureSdk, 'script-json': captureJson };

/**
 * Runs the parser corresponding to a structured capture.
 * @param capture - Typed capture configuration.
 * @param html - Successful response text.
 * @param answerUrl - Actual answering URL.
 * @returns The captured value or refusal.
 */
function captureValue(capture: PageCapture, html: string, answerUrl: string): Procedure<string> {
  const handler = CAPTURES[capture.kind];
  return handler(capture, html, answerUrl);
}

/**
 * Places a validated structured value in its configured carry slot.
 * @param capture - Capture configuration.
 * @param resp - Successful text response.
 * @param answerUrl - Actual answering URL.
 * @returns Captured carry or a value-free refusal.
 */
function captureToCarry(
  capture: PageCapture,
  resp: JsonValue,
  answerUrl: string,
): Procedure<CarryMap> {
  const html = answerText(resp);
  const result = captureValue(capture, html, answerUrl);
  if (!isOk(result)) return result;
  return succeed({ [capture.into]: result.value });
}

/**
 * Captures a configured structured value without executing page scripts.
 * @param args - The step and its configuration.
 * @param resp - Successful text response.
 * @param answerUrl - Actual answering URL.
 * @returns Captured carry or a value-free refusal.
 */
function captureStructured(
  args: IRunStepArgs,
  resp: JsonValue,
  answerUrl: string,
): Procedure<CarryMap> {
  const capture = args.step.structuredCapture;
  if (capture === undefined || capture.kind === 'jwt-claims') return succeed({});
  return captureToCarry(capture, resp, answerUrl);
}

export default captureStructured;
export { captureStructured, structuredSlotsOf };
