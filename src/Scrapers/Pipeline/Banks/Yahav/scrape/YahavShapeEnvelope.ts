/**
 * Yahav BaNCS `MessageEnvelope` builder — wraps a per-call `Payload` in the
 * fixed envelope, injecting the current timestamp, a fresh `MsgId`, and the
 * `SecToken` captured at BIND (read from the mediator session-context, never
 * hardcoded). The portfolio `iorId` captured alongside it rides every Payload.
 */

import { resolveApiMediator } from '../../../Mediator/Api/ApiMediatorAccessor.js';
import type { HeaderMap, VarsMap } from '../../../Phases/ApiDirectScrape/IApiDirectScrapeShape.js';
import type { IActionContext } from '../../../Types/PipelineContext.js';
import { isOk } from '../../../Types/Procedure.js';
import { ENVELOPE_STATIC } from './YahavEnvelopeStatic.js';
import { msgId } from './YahavShapeHelpers.js';

/** Accessor label surfaced in a mediator-missing failure message. */
const SCRAPE_LABEL = 'YahavScrape';

/** Empty SecToken used when the BIND capture is absent (BaNCS rejects loud). */
const EMPTY_SECTOKEN = { Ver: 'SecurityToken_1.0.0', Token: [] };

/** Israel wire timezone block, as captured verbatim. */
const TIMEZONE = { Ver: 'TimeZone_1.0.0', UTCOffsetHour: -3, UTCOffsetMinute: 0, Abbr: 'UTC' };

/**
 * Read a captured string from the mediator session-context.
 * @param ctx - Action context.
 * @param key - Session-context key.
 * @returns The value string, or empty when unprimed.
 */
function readSession(ctx: IActionContext, key: string): string {
  const proc = resolveApiMediator(ctx, SCRAPE_LABEL);
  if (!isOk(proc)) return '';
  const raw = proc.value.getSessionContext()[key];
  return typeof raw === 'string' ? raw : '';
}

/** Portfolio references captured at BIND — ride the accounts/balance/txns Payloads. */
export interface IPortfolioRefs {
  /** Portfolio iorId (a short opaque handle). */
  readonly iorId: string;
  /** Portfolio Id (the portfolio account number). */
  readonly id: string;
}

/**
 * Portfolio references (`iorId` + `Id`) captured at BIND — empty strings when
 * unprimed. Returned as one object so consumers read both refs from a single
 * session probe.
 * @param ctx - Action context.
 * @returns Portfolio references.
 */
export function portfolioRefs(ctx: IActionContext): IPortfolioRefs {
  const iorId = readSession(ctx, 'bancsPortfolioIorId');
  const id = readSession(ctx, 'bancsPortfolioId');
  return { iorId, id };
}

/**
 * Candidate CSRF header names, tried when BIND captured the token value but
 * not the exact header name. `csrfTkn` mirrors the login-response field; the
 * rest are the common BaNCS/Angular variants. Extra unknown headers are inert.
 */
const CSRF_CANDIDATE_NAMES = ['csrfTkn', 'X-CSRF-Token', 'X-CSRF-TOKEN', 'csrf-token'];

/**
 * CSRF request header captured at BIND, or an empty map when unprimed. Rides
 * every `/account` POST so BaNCS accepts the request (the SPA's interceptor
 * injects it and a direct fetch omits it). When BIND value-matched the exact
 * header name it is used verbatim; otherwise the token rides all candidate
 * names.
 * @param ctx - Action context.
 * @returns Header map, or empty.
 */
export function csrfHeaders(ctx: IActionContext): HeaderMap {
  const name = readSession(ctx, 'bancsCsrfName');
  const value = readSession(ctx, 'bancsCsrfValue');
  if (value.length === 0) return {};
  if (name.length > 0) return { [name]: value };
  const pairs = CSRF_CANDIDATE_NAMES.map((candidate): [string, string] => [candidate, value]);
  return Object.fromEntries(pairs);
}

/**
 * Parse the captured SecToken (a stringified `{Ver,Token:[...]}` block).
 * @param ctx - Action context.
 * @returns SecToken block, or the empty block when absent/malformed.
 */
function secToken(ctx: IActionContext): object {
  const raw = readSession(ctx, 'bancsSecToken');
  if (raw.length === 0) return EMPTY_SECTOKEN;
  try {
    return JSON.parse(raw) as object;
  } catch {
    return EMPTY_SECTOKEN;
  }
}

/**
 * Numeric calendar parts of a date (matches the BaNCS DateTime shape).
 * @param d - Current instant.
 * @returns Day/Year/Month/Hour/Minute/Second/Fraction.
 */
function dateParts(d: Date): Record<string, number> {
  return {
    Day: d.getDate(),
    Year: d.getFullYear(),
    Month: d.getMonth() + 1,
    Hour: d.getHours(),
    Minute: d.getMinutes(),
    Second: d.getSeconds(),
    Fraction: d.getMilliseconds(),
  };
}

/**
 * Current-time BaNCS timestamp block.
 * @returns Envelope `TimeStamp`.
 */
function timeStamp(): object {
  const now = new Date();
  const dttime = { Ver: 'DateTime_1.0.0', Timezone: TIMEZONE, ...dateParts(now) };
  return { Ver: 'Timestamp_1.0.0', Dttime: dttime };
}

/**
 * Wrap a per-call Payload in the full BaNCS MessageEnvelope.
 * @param ctx - Action context (SecToken source).
 * @param payload - Per-call `Payload` object.
 * @returns Envelope posted verbatim as the JSON request body.
 */
export function buildEnvelope(ctx: IActionContext, payload: VarsMap): VarsMap {
  const dynamic = {
    TimeStamp: timeStamp(),
    SecToken: secToken(ctx),
    Payload: payload,
    MsgId: msgId(),
  };
  return { ...ENVELOPE_STATIC, ...dynamic };
}
