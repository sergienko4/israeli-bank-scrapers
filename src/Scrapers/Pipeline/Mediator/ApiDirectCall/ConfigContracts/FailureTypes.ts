/**
 * FailureTypes — the failure-typing concern slice of the API-DIRECT-CALL
 * config contract. A step names how its bank says no: body pointers that
 * hold a bank error, the type of that error, and a type per 4xx reply
 * status. Each one types the failure only; the message stays the step's own.
 *
 * A root bucket: no intra-cluster deps. FlowTypes' `IStepBase` extends
 * `IStepFailureTyping`.
 *
 * Rule #11 compliance: zero bank-name strings.
 */

import type { ScraperErrorTypes } from '../../../../Base/ErrorTypes.js';

/** How a step types the failures its bank answers. */
interface IStepFailureTyping {
  /** Body pointers that, present and truthy, fail the step `<step> bank error`. */
  readonly failIfPresent?: readonly string[];
  /** Failure type of `<step> bank error`: a guard hit or a codec `error_code`; default Generic. */
  readonly bankErrorType?: ScraperErrorTypes;
  /** Failure type per 4xx reply status of `<step> HTTP <status>`; default the transport's. */
  readonly httpFailureMap?: Readonly<Record<string, ScraperErrorTypes>>;
}

export type { IStepFailureTyping };
