/**
 * Leumi scrape shape — WCF Broker envelope machinery shared by the
 * accounts / balance / transactions steps.
 *
 * Leumi's post-auth API is a single WCF endpoint
 * (`Broker.svc/ProcessRequest?moduleName=<M>`) that takes a
 * double-encoded JSON envelope `{ moduleName, reqObj, version }` — where
 * `reqObj` is the stringified per-module request — and answers with
 * `{ ProcessRequestResult, jsonResp }` where `jsonResp` is stringified
 * JSON. The runtime WCF `SessionHeader.SessionID` is primed onto the
 * mediator session-context by BIND-API-MEDIATOR (`sessionTokenCapture`)
 * and read back here — never a hardcoded secret.
 */

import { resolveApiMediator } from '../../../Mediator/Api/ApiMediatorAccessor.js';
import type { ApiBody, VarsMap } from '../../../Phases/ApiDirectScrape/IApiDirectScrapeShape.js';
import { literalUrl, type WKUrlOrLiteral } from '../../../Registry/WK/UrlsWK.js';
import type { IActionContext } from '../../../Types/PipelineContext.js';
import { isOk } from '../../../Types/Procedure.js';

/** Leumi WCF broker endpoint — the fixed post-auth API host + path. */
const LEUMI_BROKER = 'https://hb2.bankleumi.co.il/ChannelWCF/Broker.svc/ProcessRequest';

/** WCF envelope wire version — constant across every module call. */
const WCF_VERSION = 'Infra_V2.0';

/** Accessor label surfaced in a mediator-missing failure message. */
const SCRAPE_LABEL = 'LeumiScrape';

/**
 * Broker URL for one WCF module (the module rides the `moduleName` query).
 * @param module - WCF module name (e.g. `UC_SO_GetAccounts`).
 * @returns Literal absolute broker URL.
 */
export function leumiBrokerUrl(module: string): WKUrlOrLiteral {
  return literalUrl(`${LEUMI_BROKER}?moduleName=${module}`);
}

/**
 * Read the primed WCF session id from the mediator session-context.
 * @param ctx - Action context.
 * @returns SessionID string, or empty when unprimed.
 */
function sessionIdOf(ctx: IActionContext): string {
  const proc = resolveApiMediator(ctx, SCRAPE_LABEL);
  if (!isOk(proc)) return '';
  const raw = proc.value.getSessionContext().sessionToken;
  return typeof raw === 'string' ? raw : '';
}

/**
 * Build the WCF `SessionHeader` (runtime SessionID + fixed FIID).
 * @param ctx - Action context.
 * @returns SessionHeader object.
 */
export function sessionHeader(ctx: IActionContext): Record<string, string> {
  return { SessionID: sessionIdOf(ctx), FIID: 'Leumi' };
}

/**
 * Wrap a per-module inner request in the double-encoded WCF envelope.
 * @param module - WCF module name.
 * @param inner - Per-module request object (stringified into `reqObj`).
 * @returns Envelope vars map posted verbatim as the request body.
 */
export function wcfEnvelope(module: string, inner: Record<string, unknown>): VarsMap {
  return { moduleName: module, reqObj: JSON.stringify(inner), version: WCF_VERSION };
}

/**
 * Narrow an unknown parse result to a plain record (empty when not one).
 * @param parsed - Raw `JSON.parse` output.
 * @returns The value as a record, or empty when null/non-object.
 */
function narrowRecord(parsed: unknown): Record<string, unknown> {
  if (typeof parsed !== 'object' || parsed === null) return {};
  return parsed as Record<string, unknown>;
}

/**
 * JSON.parse tolerant of malformed input (returns `{}` on throw).
 * @param raw - Candidate JSON string.
 * @returns Parsed object, or empty.
 */
function safeParse(raw: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(raw) as unknown;
    return narrowRecord(parsed);
  } catch {
    return {};
  }
}

/**
 * Parse Leumi's `{ jsonResp: "<stringified>" }` response wrapper.
 * @param body - Raw WCF response body.
 * @returns Decoded inner response object (empty when absent/malformed).
 */
export function parseJsonResp(body: ApiBody): Record<string, unknown> {
  const raw = body.jsonResp;
  if (typeof raw !== 'string') return {};
  return safeParse(raw);
}
