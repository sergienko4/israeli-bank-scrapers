/**
 * Answer-classifier shape rules for an api-direct call config (N50), on login
 * and resume steps alike, checked after the optional-ref rule. A classifier
 * needs cases, each with a check; a check names exactly one kind beside its
 * pointer, and every check or capture pointer is a JSON pointer, as each of
 * its alternatives is. A text pattern is anchored, compiles alone and is flat,
 * as an extract rule's is. Every `maxChars` is an integer from 1 to 65536, a
 * capture reads one mode, and an integer range is whole and in order. The slot
 * rules of `ApiDirectClassifySlotRules.ts` run next.
 */

import type {
  AnswerPointer,
  IAnswerCapture,
  IAnswerCheck,
  IAnswerClassifier,
  IAnswerRange,
} from '../../Mediator/ApiDirectCall/ConfigContracts/index.js';
import {
  answerCapturesOf,
  answerChecksOf,
  anyClassifier,
  type IApiDirectRule,
  isBadCharCap,
  isBodyPointer,
} from './ApiDirectRuleInput.js';
import { isBadRegex, isFlatPattern } from './FlatPattern.js';

/** The kinds a check may name; `equals: null` counts as one. */
const CHECK_KINDS = ['absent', 'equals', 'oneOf', 'items', 'keys', 'text'] as const;

/**
 * Whether a classifier has no case, or a case of no check.
 * @param classifier - Answer classifier.
 * @returns True for an empty classifier or case.
 */
function hasEmptyCase(classifier: IAnswerClassifier): boolean {
  const { cases } = classifier;
  return cases.length === 0 || cases.some((answerCase): boolean => answerCase.when.length === 0);
}

/**
 * Whether a check names other than exactly one kind.
 * @param check - Answer check.
 * @returns True for no kind or several.
 */
function isNotOneKind(check: IAnswerCheck): boolean {
  const named = CHECK_KINDS.filter((kind): boolean => check[kind] !== undefined);
  return named.length !== 1;
}

/**
 * Whether a pointer has no alternative, or one that is not a JSON pointer.
 * @param pointer - Pointer or alternatives.
 * @returns True for a bad pointer.
 */
function isBadPointer(pointer: AnswerPointer): boolean {
  const alternatives = typeof pointer === 'string' ? [pointer] : pointer;
  return alternatives.length === 0 || !alternatives.every(isBodyPointer);
}

/**
 * Every capture of a classifier's cases.
 * @param classifier - Answer classifier.
 * @returns The captures, in case order.
 */
function capturesOf(classifier: IAnswerClassifier): readonly IAnswerCapture[] {
  const entries = answerCapturesOf(classifier);
  return entries.map(([, capture]) => capture);
}

/**
 * Whether a classifier holds a bad check or capture pointer.
 * @param classifier - Answer classifier.
 * @returns True for any bad pointer.
 */
function hasBadPointer(classifier: IAnswerClassifier): boolean {
  const checks = answerChecksOf(classifier).map(check => check.pointer);
  const captures = capturesOf(classifier).map(capture => capture.pointer);
  return [...checks, ...captures].some(isBadPointer);
}

/**
 * Every text pattern of a classifier's checks.
 * @param classifier - Answer classifier.
 * @returns The patterns, in case order.
 */
function patternsOf(classifier: IAnswerClassifier): readonly string[] {
  const checks = answerChecksOf(classifier);
  return checks.flatMap(({ text }): string[] =>
    text?.pattern === undefined ? [] : [text.pattern],
  );
}

/**
 * Every `maxChars` of a classifier's text checks and captures.
 * @param classifier - Answer classifier.
 * @returns The caps, in case order.
 */
function capsOf(classifier: IAnswerClassifier): readonly number[] {
  const checks = answerChecksOf(classifier);
  const texts = checks.flatMap(({ text }): number[] => (text === undefined ? [] : [text.maxChars]));
  const captures = capturesOf(classifier).map(capture => capture.maxChars);
  return [...texts, ...captures];
}

/**
 * Whether an integer range is fractional or upside down.
 * @param range - Inclusive range.
 * @returns True for a bad range.
 */
function isBadRange(range: IAnswerRange): boolean {
  const isWhole = Number.isInteger(range.min) && Number.isInteger(range.max);
  return !isWhole || range.min > range.max;
}

/**
 * Whether a capture reads both the `onlyKey` and the `integer` mode.
 * @param capture - Answer capture.
 * @returns True for two modes.
 */
function isTwoModes(capture: IAnswerCapture): boolean {
  return capture.onlyKey !== undefined && capture.integer !== undefined;
}

/**
 * Whether a capture's integer range is fractional or upside down.
 * @param capture - Answer capture.
 * @returns True for a bad range.
 */
function hasBadIntegerRange(capture: IAnswerCapture): boolean {
  return capture.integer !== undefined && isBadRange(capture.integer);
}

/** Answer-classifier shape rules, checked after the optional-ref rule. */
const API_DIRECT_CLASSIFY_RULES: readonly IApiDirectRule[] = [
  {
    message: 'steps.classify: needs cases, each with a check',
    isBroken: anyClassifier(hasEmptyCase),
  },
  {
    message: 'steps.classify: each check names exactly one kind',
    isBroken: anyClassifier(c => answerChecksOf(c).some(isNotOneKind)),
  },
  {
    message: 'steps.classify: each pointer must be a JSON pointer',
    isBroken: anyClassifier(hasBadPointer),
  },
  {
    message: 'steps.classify.text.pattern: must be an anchored regex',
    isBroken: anyClassifier(c => patternsOf(c).some(isBadRegex)),
  },
  {
    message: 'steps.classify.text.pattern: must be a flat regex',
    isBroken: anyClassifier(c => !patternsOf(c).every(isFlatPattern)),
  },
  {
    message: 'steps.classify.maxChars: must be an integer from 1 to 65536',
    isBroken: anyClassifier(c => capsOf(c).some(isBadCharCap)),
  },
  {
    message: 'steps.classify.captures: onlyKey and integer are exclusive',
    isBroken: anyClassifier(c => capturesOf(c).some(isTwoModes)),
  },
  {
    message: 'steps.classify.captures.integer: must be an integer range',
    isBroken: anyClassifier(c => capturesOf(c).some(hasBadIntegerRange)),
  },
];

export default API_DIRECT_CLASSIFY_RULES;
export { API_DIRECT_CLASSIFY_RULES };
