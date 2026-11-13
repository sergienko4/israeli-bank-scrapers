/**
 * The diagnostic an execution emits when disposing its mediator fails.
 *
 * <p>Disposal runs after the scrape has already produced its outcome, so a
 * failure there must neither change that outcome nor escape. It is still worth
 * knowing about: a mediator that cannot release its connection leaks one per run.
 * The warning therefore names only the error class and, when the cause carries
 * one, its machine-readable code — never the thrown value, its message, a header
 * or a body, any of which can quote a credential or a bank answer. Attribution
 * (`bank`, `runId`, `phase`, `stage`) is added by the execution's own log scope.
 *
 * <p>The logger is itself a place that can fail, so the emit is guarded: a
 * throwing sink is swallowed here and cannot become a second escaping error.
 */
import { errorCauseCodeOf, errorNameOf } from '../../Types/ErrorUtils.js';
import type { IPipelineContext } from '../../Types/PipelineContext.js';

/**
 * The shapes a system, undici or TLS error code takes. A diagnostic reports a
 * code only when it looks like one, so an uppercase token that merely matches
 * the generic code pattern (a secret-shaped value in a hostile `cause.code`) is
 * dropped instead of logged.
 */
const CODE_SHAPES: readonly RegExp[] = [
  /^E[A-Z0-9_]{2,30}$/,
  /^UND_ERR_[A-Z0-9_]{1,30}$/,
  /^ERR_[A-Z0-9_]{2,40}$/,
  /^CERT_[A-Z0-9_]{2,30}$/,
  /^UNABLE_TO_[A-Z0-9_]{2,40}$/,
  /^(?:DEPTH_ZERO_SELF_SIGNED_CERT|SELF_SIGNED_CERT_IN_CHAIN)$/,
];

/**
 * The cause code of a failure, kept only when it has the shape of a real error code.
 * @param error - The unknown value disposal threw.
 * @returns The code, or an empty string.
 */
function reportableCauseCode(error: unknown): string {
  const code = errorCauseCodeOf(error);
  const hasKnownShape = CODE_SHAPES.some((shape): boolean => shape.test(code));
  return hasKnownShape ? code : '';
}

/** The structured fields of the cleanup warning — an allowlist, nothing else. */
interface ICleanupWarning {
  readonly event: 'cleanup-failed';
  readonly resource: 'api-mediator';
  readonly errorName: string;
  readonly causeCode: string;
}

/**
 * Build the allowlisted fields for a failed disposal.
 * @param error - The unknown value disposal threw.
 * @returns The fields to log.
 */
function buildCleanupWarning(error: unknown): ICleanupWarning {
  return {
    event: 'cleanup-failed',
    resource: 'api-mediator',
    errorName: errorNameOf(error),
    causeCode: reportableCauseCode(error),
  };
}

/**
 * Report a failed disposal through the execution's logger without ever throwing.
 * @param ctx - The pipeline context carrying the execution's logger.
 * @param error - The unknown value disposal threw.
 * @returns True once attempted, whether or not the sink accepted the record.
 */
function reportCleanupFailure(ctx: IPipelineContext, error: unknown): true {
  try {
    const fields = buildCleanupWarning(error);
    ctx.logger.warn(fields, 'api-mediator disposal failed');
  } catch {
    /* silent: a failing diagnostic sink must never become a second failure */
  }
  return true;
}

export type { ICleanupWarning };
export { buildCleanupWarning, reportCleanupFailure };
