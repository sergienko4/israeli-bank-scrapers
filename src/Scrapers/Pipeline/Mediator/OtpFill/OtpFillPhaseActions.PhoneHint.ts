/**
 * OTP-FILL phone-hint deep scanner — extracts the masked phone digits
 * from EVERY frame on the page so banks that render the SMS challenge
 * inside an iframe still surface a hint for the retriever banner.
 */

import type { IPipelineContext } from '../../Types/PipelineContext.js';
import { PHONE_HINT_PATTERN, PHONE_LAST_DIGITS } from '../Otp/OtpDetectorConfig.js';

/** Frame shape minimum needed by {@link extractHintFromFrame}. */
interface IEvaluable {
  evaluate: (fn: () => string) => Promise<string>;
}

/**
 * Read the frame's visible body text — returns empty string when the
 * frame is detached or page.evaluate rejects mid-navigation.
 * @param frame - Page or Frame with an {@link IEvaluable.evaluate}.
 * @returns Body inner text or `''` when unavailable.
 */
async function readBodyText(frame: IEvaluable): Promise<string> {
  return frame.evaluate((): string => document.body.innerText).catch((): string => '');
}

/**
 * Pull the last 3-4 digits substring from a body text via the
 * configured PHONE_HINT_PATTERN + PHONE_LAST_DIGITS regexes.
 * @param bodyText - Visible body text of the frame.
 * @returns Captured digits, or `''` when no full-hint match.
 */
function matchFullHint(bodyText: string): string {
  const fullMatch = PHONE_HINT_PATTERN.exec(bodyText);
  if (!fullMatch) return '';
  const digits = PHONE_LAST_DIGITS.exec(fullMatch[0]);
  if (!digits) return '';
  return digits[1];
}

/**
 * Extract phone hint from a single frame's body text.
 * @param frame - Page or Frame to scan.
 * @returns Last 3-4 digits or empty.
 */
async function extractHintFromFrame(frame: IEvaluable): Promise<string> {
  const bodyText = await readBodyText(frame);
  return matchFullHint(bodyText);
}

/**
 * Reduce phone hint — short-circuit on first found.
 * @param acc - Accumulated hint promise.
 * @param frame - Current frame.
 * @returns First non-empty hint.
 */
function reduceHint(acc: Promise<string>, frame: IEvaluable): Promise<string> {
  return acc.then(async (found): Promise<string> => {
    if (found) return found;
    return extractHintFromFrame(frame);
  });
}

/**
 * Extract phone hint from all frames (main + iframes).
 * @param input - Pipeline context with browser.
 * @returns Last 3-4 digits or empty.
 */
async function extractDeepPhoneHint(input: IPipelineContext): Promise<string> {
  if (!input.browser.has) return '';
  const page = input.browser.value.page;
  const frames: IEvaluable[] = [...page.frames()];
  const seed: Promise<string> = Promise.resolve('');
  return frames.reduce<Promise<string>>((acc, f): Promise<string> => reduceHint(acc, f), seed);
}

export default extractDeepPhoneHint;
