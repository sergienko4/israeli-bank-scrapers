/**
 * BalanceResolveActions.Fetch — JSON parse helper + single-fetch
 * dispatch helpers. Extracted from the BalanceResolveActions barrel
 * so the per-file LoC cap is honoured (phase-2e-residue split).
 */

import { ScraperErrorTypes } from '../../../Base/ErrorTypes.js';
import type {
  IActionContext,
  IApiFetchContext,
  IBalanceFetchPlanEntry,
} from '../../Types/PipelineContext.js';
import type { Procedure } from '../../Types/Procedure.js';
import { fail } from '../../Types/Procedure.js';

/** Empty parsed-body sentinel. */
const EMPTY_PARSED_BODY: Readonly<Record<string, string | object>> = Object.freeze({});

/**
 * Narrow a parsed-JSON value to a plain record.
 * @param parsed - JSON.parse result.
 * @returns Plain record, or the empty sentinel.
 */
function narrowParsed(parsed: unknown): Record<string, string | object> {
  if (parsed === null) return EMPTY_PARSED_BODY;
  if (typeof parsed !== 'object') return EMPTY_PARSED_BODY;
  if (Array.isArray(parsed)) return EMPTY_PARSED_BODY;
  return parsed as Record<string, string | object>;
}

/**
 * Emit the structured warn fired when JSON.parse threw.
 * @param raw - The original JSON string (only its length is logged).
 * @param logger - Pipeline logger sink.
 * @returns Always true (sentinel for callers).
 */
function warnBodyParseFailure(raw: string, logger: IActionContext['logger']): true {
  logger.warn({
    event: 'balance-resolve.body-parse-failure',
    bodyLen: String(raw.length),
    message: 'malformed request body — sending empty payload; downstream MISS likely',
  });
  return true;
}

/** Bundled args for the body-parser helpers. */
interface IParseBodyArgs {
  readonly raw: string;
  readonly logger: IActionContext['logger'];
}

/**
 * Try-parse a JSON string to a record, narrowing or emitting the parse warn.
 * @param args - Bundled raw + logger.
 * @returns Narrowed record, or the empty sentinel on parse error.
 */
function tryParseJsonBody(args: IParseBodyArgs): Record<string, string | object> {
  try {
    const parsed: unknown = JSON.parse(args.raw);
    return narrowParsed(parsed);
  } catch {
    warnBodyParseFailure(args.raw, args.logger);
    return EMPTY_PARSED_BODY;
  }
}

/**
 * Parse a JSON string to a record without throwing across module boundaries.
 * @param raw - JSON string (may be empty).
 * @param logger - Pipeline logger for the body-parse-failure warn.
 * @returns Record (empty when raw is empty / non-object / malformed).
 */
function safeParseJson(
  raw: string,
  logger: IActionContext['logger'],
): Record<string, string | object> {
  if (raw.length === 0) return EMPTY_PARSED_BODY;
  return tryParseJsonBody({ raw, logger });
}

/**
 * Issue a single live fetch via the IApiFetchContext surface.
 * POST decoded from request.body JSON; GET issued by URL only.
 * @param api - API fetch context.
 * @param entry - Plan entry to execute.
 * @param logger - Pipeline logger (for body-parse-failure warns).
 * @returns Procedure<unknown> wrapping the response body.
 */
async function issueOneFetch(
  api: IApiFetchContext,
  entry: IBalanceFetchPlanEntry,
  logger: IActionContext['logger'],
): Promise<Procedure<unknown>> {
  if (entry.request.method !== 'POST') return api.fetchGet<unknown>(entry.request.url);
  const parsedBody = safeParseJson(entry.request.body, logger);
  return api.fetchPost<unknown>(entry.request.url, parsedBody);
}

/**
 * Bundle holding the per-fetch correlation id plus the IActionContext
 * fields fetchAllPlanEntries reads.
 */
interface IFetchExecCtx {
  readonly api: IApiFetchContext;
  readonly logger: IActionContext['logger'];
  readonly correlationId: string;
}

/** Failure procedure emitted when `api.fetch*` throws. */
const FETCH_THREW_FAILURE: Procedure<unknown> = fail(
  ScraperErrorTypes.Generic,
  'balance-resolve.action: api.fetch threw — quarantined per Promise.all contract',
);

/**
 * Wraps {@link issueOneFetch} so a *thrown* exception is converted to a
 * `Procedure` fail instead of propagating through `Promise.all`.
 * @param ctx - Fetch execution context.
 * @param entry - Plan entry being dispatched.
 * @returns Procedure wrapping success or a typed failure.
 */
async function safeIssueOneFetch(
  ctx: IFetchExecCtx,
  entry: IBalanceFetchPlanEntry,
): Promise<Procedure<unknown>> {
  try {
    return await issueOneFetch(ctx.api, entry, ctx.logger);
  } catch {
    return FETCH_THREW_FAILURE;
  }
}

export type { IFetchExecCtx };
export { safeIssueOneFetch };
