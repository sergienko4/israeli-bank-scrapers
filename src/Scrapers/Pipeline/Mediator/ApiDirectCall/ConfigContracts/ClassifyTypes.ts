/**
 * ClassifyTypes — the answer-classifier concern slice of the API-DIRECT-CALL
 * config contract (N50). A step's `classify` names the shapes its opened
 * answer may take; exactly one case must match, and its name goes to carry.
 *
 * A root bucket: no intra-cluster deps. FlowTypes references
 * `IAnswerClassifier` from `IStepBase`.
 *
 * Rule #11 compliance: zero bank-name strings.
 */

import type { ScraperErrorTypes } from '../../../../Base/ErrorTypes.js';

/** A JSON pointer, or alternatives of which the first that resolves is read. */
type AnswerPointer = string | readonly string[];

/** A text check: 1..`maxChars` chars, no control char, whole `pattern` match. */
interface IAnswerText {
  readonly maxChars: number;
  /** Regex source (`u` flag), matched against the whole text. */
  readonly pattern?: string;
}

/** One check of a case; it holds exactly one kind beside its pointer. */
interface IAnswerCheck {
  readonly pointer: AnswerPointer;
  /** Passes only when no alternative resolves. */
  readonly absent?: true;
  /** The value, compared with `===`. */
  readonly equals?: string | number | boolean | null;
  /** Values the string or number may take, compared with `===`. */
  readonly oneOf?: readonly (string | number)[];
  /** An array of exactly this many items. */
  readonly items?: number;
  /** An object of exactly this many keys. */
  readonly keys?: number;
  readonly text?: IAnswerText;
  /** Inverts the verdict of the check's kind (N60). */
  readonly negate?: true;
}

/** An inclusive range of safe integers. */
interface IAnswerRange {
  readonly min: number;
  readonly max: number;
}

/**
 * One carry slot a matched case writes. By default the value must be text of
 * 1..`maxChars` chars with no control char; `onlyKey` reads the one key of an
 * object instead, and `integer` a safe JSON integer in range, as decimal text.
 */
interface IAnswerCapture {
  readonly pointer: AnswerPointer;
  readonly maxChars: number;
  readonly onlyKey?: true;
  readonly integer?: IAnswerRange;
}

/** One shape the answer may take; its name may repeat across cases. */
interface IAnswerCase {
  /** Written to carry `into` when the case matches. */
  readonly name: string;
  /** Checks that must all pass. */
  readonly when: readonly IAnswerCheck[];
  /** Fails the step with this type when the case matches. */
  readonly fail?: ScraperErrorTypes;
  readonly captures?: Readonly<Record<string, IAnswerCapture>>;
}

/** A step's answer classifier (N50): exactly one case must match. */
interface IAnswerClassifier {
  /** Carry slot the matched case's name goes to. */
  readonly into: string;
  readonly cases: readonly IAnswerCase[];
}

export type {
  AnswerPointer,
  IAnswerCapture,
  IAnswerCase,
  IAnswerCheck,
  IAnswerClassifier,
  IAnswerRange,
  IAnswerText,
};
