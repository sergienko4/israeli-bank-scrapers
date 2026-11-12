import { getDebug } from '../../../../Logging/Debug.js';

const LOG = getDebug(import.meta.url);
const TAG_NAMES = ['html', 'title', 'form', 'input', 'script', 'iframe'] as const;
const TAG_PATTERN = /<(html|title|form|input|script|iframe)(?=[\s/>])/gi;

/** Capture context; response text is counted locally, never emitted. */
interface ICaptureDiagnosticInput {
  readonly stepName: string;
  readonly text: string;
}

/**
 * Count lexical opening-tag hints, not parsed elements or challenge verdicts.
 * @param text - Answer text.
 * @returns Counts with fixed, bank-independent keys.
 */
function tagCounts(text: string): Readonly<Record<string, number>> {
  const entries = TAG_NAMES.map((name): readonly [string, number] => [name, 0]);
  const counts = Object.fromEntries(entries);
  for (const match of text.matchAll(TAG_PATTERN)) {
    const name = match[1].toLowerCase();
    counts[name] += 1;
  }
  return counts;
}

/**
 * Describe a refusal without response values, attributes, URLs or titles.
 * @param input - The step and its answer.
 * @param slot - Configured capture slot.
 * @param reason - Fixed refusal reason.
 * @returns Logging completion sentinel.
 */
function logCaptureRefusal(input: ICaptureDiagnosticInput, slot: string, reason: string): true {
  const descriptor = {
    stepName: input.stepName,
    textLength: input.text.length,
    tagCounts: tagCounts(input.text),
  };
  LOG.debug({ ...descriptor, slot, reason, message: '[textCapture] refused' });
  return true;
}

export default logCaptureRefusal;
export { logCaptureRefusal };
