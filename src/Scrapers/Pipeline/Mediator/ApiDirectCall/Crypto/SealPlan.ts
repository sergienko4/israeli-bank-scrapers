/**
 * SealPlan — what a seal hands the step: the body writes it plans. A seal
 * reads its refs through the step's resolver, so Crypto stays free of the
 * template layer; the step writes each value at its pointer.
 */

import type { Procedure } from '../../../Types/Procedure.js';

/** One sealed value and the body pointer it goes to. */
interface ISealedWrite {
  readonly writeTo: string;
  readonly value: string;
}

/** The refs a seal reads: credential sources and carry keys. */
type SealRef = `carry.${string}` | `creds.${string}`;

/** Reads a seal ref as text; false when absent. */
type SealRefText = (ref: SealRef) => string | false;

/** The writes a seal plans, or a failure that names no value. */
type SealPlan = Procedure<readonly ISealedWrite[]>;

export type { ISealedWrite, SealPlan, SealRef, SealRefText };
