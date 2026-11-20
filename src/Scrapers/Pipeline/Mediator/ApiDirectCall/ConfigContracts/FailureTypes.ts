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

/** A refused redirect that can only be the bank's auth portal. */
interface IRedirectAuthRejection {
  /** Statuses that may carry the refusal, e.g. `[302]`. */
  readonly statuses: readonly number[];
  /** Exact `scheme://host[:port]` the redirect must target. */
  readonly origin: string;
  /** Exact target path, e.g. `/invalid_session`. */
  readonly path: string;
}

/** How a step types the failures its bank answers. */
interface IStepFailureTyping {
  /** Body pointers that, present and truthy, fail the step `<step> bank error`. */
  readonly failIfPresent?: readonly string[];
  /** Failure type of `<step> bank error`: a guard hit or a codec `error_code`; default Generic. */
  readonly bankErrorType?: ScraperErrorTypes;
  /**
   * Body pointers holding the bank's stable error code, read in order. The
   * first string or finite number that resolves is the code.
   */
  readonly bankErrorCodePointers?: readonly string[];
  /**
   * Failure type by the code at `bankErrorCodePointers`; an unknown code falls
   * back to `bankErrorType`, then Generic.
   */
  readonly bankErrorTypeByCode?: Readonly<Record<string, ScraperErrorTypes>>;
  /** Failure type per 4xx reply status of `<step> HTTP <status>`; default the transport's. */
  readonly httpFailureMap?: Readonly<Record<string, ScraperErrorTypes>>;
  /**
   * Treat a refused redirect from this step as the bank rejecting the
   * session, but only when its status, origin and path match this rule. Only
   * a step whose redirect target is the bank's auth portal sets this; every
   * other step keeps a refused 3xx as a plain transport failure.
   */
  readonly redirectRefusalIsAuthRejected?: IRedirectAuthRejection;
}

export type { IStepFailureTyping };
