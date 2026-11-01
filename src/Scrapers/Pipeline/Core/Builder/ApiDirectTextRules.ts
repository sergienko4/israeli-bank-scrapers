/**
 * Text rules for an api-direct call config (N36). `textCaptures` and
 * `maxTextChars` act on a `text` answer only, so a step naming either must
 * read `response: 'text'`. `maxTextChars` must be an integer from 1 to
 * 2097152. A capture `pattern` must compile with the `g` flag and must not
 * repeat a group — `(…)` followed by `*`, `+` or `{`, the shape that
 * backtracks without bound; its `group` must be an integer from 0 (the whole
 * match) to the pattern's group count. The login-form capture rules (N37)
 * of `ApiDirectFormCaptureRules.ts` run last.
 */

import type {
  IStepConfig,
  ITextCapture,
} from '../../Mediator/ApiDirectCall/ConfigContracts/index.js';
import { API_DIRECT_FORM_CAPTURE_RULES } from './ApiDirectFormCaptureRules.js';
import { anyStep, type IApiDirectRule } from './ApiDirectRuleInput.js';

/** Longest text answer a step may accept, in chars (2 MiB). */
const MAX_TEXT_CHARS = 2_097_152;

/** Escapes and character classes, which may hold a literal `)`. */
const LITERAL_PARTS = /\\.|\[(?:\\.|[^\\\]])*\]/gu;

/** A group closed, then repeated. */
const REPEATED_GROUP = /\)[*+{]/u;

/** A check on one capture. */
type CaptureCheck = (capture: ITextCapture) => boolean;

/**
 * A rule check over every capture of every login and resume step.
 * @param isBad - Capture check.
 * @returns True when any capture fails it.
 */
function anyCapture(isBad: CaptureCheck): IApiDirectRule['isBroken'] {
  return anyStep((step): boolean => Object.values(step.textCaptures ?? {}).some(isBad));
}

/**
 * Whether a step captures text off a `text` answer.
 * @param step - Login step.
 * @returns True for `textCaptures` on a step that reads no text.
 */
function isCaptureOffText(step: IStepConfig): boolean {
  return step.textCaptures !== undefined && step.response !== 'text';
}

/**
 * Whether a step caps a text answer it never reads.
 * @param step - Login step.
 * @returns True for `maxTextChars` on a step that reads no text.
 */
function isCapOffText(step: IStepConfig): boolean {
  return step.maxTextChars !== undefined && step.response !== 'text';
}

/**
 * Whether a step's text cap is out of range.
 * @param step - Login step.
 * @returns True for a `maxTextChars` that is not an integer from 1 to 2097152.
 */
function isBadTextCap(step: IStepConfig): boolean {
  const cap = step.maxTextChars;
  if (cap === undefined) return false;
  return !Number.isInteger(cap) || cap < 1 || cap > MAX_TEXT_CHARS;
}

/**
 * Compile a capture pattern as the step does.
 * @param pattern - Regex source.
 * @returns The regex, or false when it does not compile.
 */
function compiled(pattern: string): RegExp | false {
  try {
    return new RegExp(pattern, 'g');
  } catch {
    return false;
  }
}

/**
 * Whether a capture pattern does not compile.
 * @param capture - Text capture.
 * @returns True for a broken pattern.
 */
function isUncompilable(capture: ITextCapture): boolean {
  return compiled(capture.pattern) === false;
}

/**
 * Whether a capture pattern repeats a group.
 * @param capture - Text capture.
 * @returns True when a group is followed by `*`, `+` or `{`.
 */
function repeatsGroup(capture: ITextCapture): boolean {
  const structure = capture.pattern.replaceAll(LITERAL_PARTS, '');
  return REPEATED_GROUP.test(structure);
}

/**
 * How many groups a compiling pattern holds: one empty alternative makes it
 * match '' with every group unset.
 * @param pattern - Regex source that compiles.
 * @returns Its group count.
 */
function groupCount(pattern: string): number {
  const emptyMatch = compiled(`${pattern}|`);
  const groups = emptyMatch === false ? null : emptyMatch.exec('');
  return groups === null ? 0 : groups.length - 1;
}

/**
 * Whether a capture names a group its pattern lacks.
 * @param capture - Text capture.
 * @returns True for a group that is not an integer from 0 to the group count.
 */
function isBadGroup(capture: ITextCapture): boolean {
  if (isUncompilable(capture)) return false;
  const { group } = capture;
  if (!Number.isInteger(group) || group < 0) return true;
  return group > groupCount(capture.pattern);
}

/** Text rules, checked after the step rules, then the login-form capture rules. */
const API_DIRECT_TEXT_RULES: readonly IApiDirectRule[] = [
  { message: 'steps.textCaptures: need a text response', isBroken: anyStep(isCaptureOffText) },
  { message: 'steps.maxTextChars: needs a text response', isBroken: anyStep(isCapOffText) },
  {
    message: 'steps.maxTextChars: must be an integer from 1 to 2097152',
    isBroken: anyStep(isBadTextCap),
  },
  { message: 'steps.textCaptures.pattern: must compile', isBroken: anyCapture(isUncompilable) },
  {
    message: 'steps.textCaptures.pattern: must not repeat a group',
    isBroken: anyCapture(repeatsGroup),
  },
  {
    message: 'steps.textCaptures.group: must name a group of its pattern',
    isBroken: anyCapture(isBadGroup),
  },
  ...API_DIRECT_FORM_CAPTURE_RULES,
];

export default API_DIRECT_TEXT_RULES;
export { API_DIRECT_TEXT_RULES };
