/**
 * Shared OTP utilities — used by both OtpTrigger and OtpFill mediators.
 * Eliminates duplication between the two phase action files.
 */

import type {
  IActionContext,
  IPipelineContext,
  IResolvedTarget,
} from '../../Types/PipelineContext.js';
import type { Procedure } from '../../Types/Procedure.js';
import { isOk, succeed } from '../../Types/Procedure.js';
import { screenshotPath } from '../../Types/RunLabel.js';
import type { IRaceResult } from '../Elements/ElementMediator.js';

/** Phone hint — last 3-4 digits of phone number. */
type PhoneHint = string;
/** Screenshot file path label. */
type ScreenshotLabel = string;
/** Short diagnostic label. */
type DiagnosticLabel = string;

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
 * Take OTP diagnostic screenshot.
 * @param input - Pipeline context with browser.
 * @param label - Screenshot label suffix.
 * @returns Path or empty.
 */
async function otpScreenshot(
  input: IPipelineContext,
  label: ScreenshotLabel,
): Promise<ScreenshotLabel> {
  if (!input.browser.has) return '';
  const path = screenshotPath(input.companyId, label);
  if (path.length === 0) return '';
  const page = input.browser.value.page;
  await page.screenshot({ path }).catch((): false => false);
  input.logger.debug({ message: `screenshot: ${path}` });
  return path;
}

/**
 * Read a resolved target from diagnostics by key.
 * @param diag - Diagnostics state.
 * @param key - Diagnostic key.
 * @returns Resolved target or false.
 */
function readDiagTarget(
  diag: IActionContext['diagnostics'],
  key: DiagnosticLabel,
): IResolvedTarget | false {
  const bag = diag as unknown as Readonly<Record<string, IResolvedTarget | false>>;
  return bag[key] || false;
}

/**
 * Read a string value from diagnostics by key.
 * @param diag - Diagnostics state.
 * @param key - Diagnostic key.
 * @returns Value or empty string.
 */
function readDiagString(diag: IActionContext['diagnostics'], key: DiagnosticLabel): PhoneHint {
  const bag = diag as unknown as Readonly<Record<string, string>>;
  return bag[key] || '';
}

export type { DiagnosticLabel, PhoneHint, ScreenshotLabel };
export { NOT_FOUND, OTP_FALLBACK, otpScreenshot, readDiagString, readDiagTarget, unwrapProbe };
