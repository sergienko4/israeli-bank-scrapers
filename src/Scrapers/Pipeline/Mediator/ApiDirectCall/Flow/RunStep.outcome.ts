/**
 * Step outcome policy. Some banks answer a refused login with HTTP 200 and a
 * status code in the body. A step that declares `outcome` has that code
 * judged after the 2xx and before its extracts run, so a wrong password fails
 * with its own error type instead of as a missing extract. A
 * `caseInsensitive` policy lower-cases the code, the success codes and the
 * failure-map keys before matching.
 */

import type { ScraperErrorTypes } from '../../../../Base/ErrorTypes.js';
import type { Procedure } from '../../../Types/Procedure.js';
import { fail, isOk, succeed } from '../../../Types/Procedure.js';
import type { IStepConfig, IStepOutcome } from '../ConfigContracts/index.js';
import type { JsonValue } from '../Envelope/JsonPointer.js';
import { walkPointer } from '../Envelope/JsonPointer.js';

/**
 * Render a scalar as an outcome code; numbers and booleans compare as text.
 * @param value - Value found at the code pointer.
 * @returns The code, or false when the value is not a non-empty scalar.
 */
function scalarCode(value: JsonValue): string | false {
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (typeof value === 'string' && value !== '') return value;
  return false;
}

/**
 * Read the step's outcome code from the response body.
 * @param resp - Parsed 2xx response body.
 * @param pointer - JSON pointer to the code.
 * @returns The code, or false when it is absent.
 */
function readOutcomeCode(resp: JsonValue, pointer: string): string | false {
  const walked = walkPointer(resp, pointer);
  if (!isOk(walked)) return false;
  return scalarCode(walked.value);
}

/**
 * Judge a present code: success passes; a code the map owns fails with its
 * type; any other code fails with the default. Only the map's own keys count,
 * so `toString` is unmapped. An unmapped code is never echoed: it comes from
 * the bank, not the config, and may carry a secret.
 * @param name - Step name, for the failure message.
 * @param outcome - The step's outcome policy.
 * @param code - Code read from the body.
 * @returns Success, or the mapped failure.
 */
function judgeCode(name: string, outcome: IStepOutcome, code: string): Procedure<true> {
  if (outcome.successCodes.includes(code)) return succeed(true);
  const failureMap: Partial<Record<string, ScraperErrorTypes>> = outcome.failureMap;
  const isMapped = Object.hasOwn(failureMap, code);
  if (!isMapped) return fail(outcome.defaultFailure, `${name} outcome unmapped`);
  const errorType = failureMap[code] ?? outcome.defaultFailure;
  return fail(errorType, `${name} outcome ${code}`);
}

/**
 * Lower-case one code.
 * @param code - Code from the body or the config.
 * @returns The code in lower case.
 */
function lowerCode(code: string): string {
  return code.toLowerCase();
}

/**
 * The policy with its success codes and failure-map keys lower-cased.
 * @param outcome - A `caseInsensitive` policy.
 * @returns The lower-cased policy.
 */
function caselessOutcome(outcome: IStepOutcome): IStepOutcome {
  const successCodes = outcome.successCodes.map(lowerCode);
  const entries = Object.entries(outcome.failureMap);
  const lowered = entries.map(([code, type]): [string, ScraperErrorTypes] => [
    lowerCode(code),
    type,
  ]);
  const failureMap = Object.fromEntries(lowered);
  return { ...outcome, successCodes, failureMap };
}

/**
 * Judge a step's 2xx body against its outcome policy, if it declares one.
 * @param step - The step that just answered.
 * @param resp - Parsed 2xx response body.
 * @returns Success when the step has no policy or reports success.
 */
function judgeStepOutcome(step: IStepConfig, resp: JsonValue): Procedure<true> {
  const outcome = step.outcome;
  if (outcome === undefined) return succeed(true);
  const code = readOutcomeCode(resp, outcome.codePointer);
  if (code === false) return fail(outcome.defaultFailure, `${step.name} outcome missing`);
  if (outcome.caseInsensitive !== true) return judgeCode(step.name, outcome, code);
  const caseless = caselessOutcome(outcome);
  const lowered = lowerCode(code);
  return judgeCode(step.name, caseless, lowered);
}

export default judgeStepOutcome;

export { judgeStepOutcome };
