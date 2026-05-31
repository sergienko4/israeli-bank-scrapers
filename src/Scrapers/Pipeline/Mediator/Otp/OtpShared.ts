/**
 * Shared OTP utilities — used by both OtpTrigger and OtpFill mediators.
 * Eliminates duplication between the two phase action files.
 */

import type { IActionContext, IResolvedTarget } from '../../Types/PipelineContext.js';
import type { Procedure } from '../../Types/Procedure.js';
import { isOk, succeed } from '../../Types/Procedure.js';
import type { IRaceResult } from '../Elements/ElementMediator.js';

/** Not-found sentinel. */
const NOT_FOUND: IRaceResult = {
  found: false,
  locator: false,
  candidate: false,
  context: false,
  index: -1,
  value: '',
  identity: false,
};

/**
 * OTP probe fallback — returns NOT_FOUND sentinel.
 * @returns Succeed with NOT_FOUND.
 */
const OTP_FALLBACK = (): Procedure<IRaceResult> => succeed(NOT_FOUND);

/**
 * Unwrap probe result — NOT_FOUND if probe failed.
 * @param probe - Procedure from probe.
 * @returns IRaceResult or NOT_FOUND sentinel.
 */
function unwrapProbe(probe: Procedure<IRaceResult>): IRaceResult {
  if (isOk(probe) && probe.value.found) return probe.value;
  return NOT_FOUND;
}

/**
 * Read a resolved target from diagnostics by key.
 * @param diag - Diagnostics state.
 * @param key - Diagnostic key.
 * @returns Resolved target or false.
 */
function readDiagTarget(diag: IActionContext['diagnostics'], key: string): IResolvedTarget | false {
  const bag = diag as unknown as Readonly<Record<string, IResolvedTarget | false>>;
  return bag[key] || false;
}

/**
 * Read a string value from diagnostics by key.
 * @param diag - Diagnostics state.
 * @param key - Diagnostic key.
 * @returns Value or empty string.
 */
function readDiagString(diag: IActionContext['diagnostics'], key: string): string {
  const bag = diag as unknown as Readonly<Record<string, string>>;
  return bag[key] || '';
}

export { NOT_FOUND, OTP_FALLBACK, readDiagString, readDiagTarget, unwrapProbe };
