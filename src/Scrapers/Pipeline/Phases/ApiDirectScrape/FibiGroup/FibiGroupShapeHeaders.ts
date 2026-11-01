/**
 * FIBI group scrape shape — per-call request headers. Every financial call
 * sends a fresh `X-FIBI-Transaction-Id`, as the portal shell does. Once a
 * headless login has stored the portal-shell `authorization` answer (the
 * bank config's `sessionCarry`), every call also sends it verbatim as
 * `Authorization`, with what the portal page itself sends: a JSON
 * `Accept`, the library's `User-Agent` and — from the landing URL the
 * login kept — its `Origin` and `Referer`. The browser path holds no
 * authorization slot — its bus already sends the page's headers — so the
 * shape adds only the transaction id there.
 */

import { randomUUID } from 'node:crypto';

import type { SessionContext } from '../../../Mediator/Api/ApiMediator.js';
import { FIBI_UA } from '../../../Registry/Config/PipelineBankConfigFibiFamilyConstants.js';
import { isSome } from '../../../Types/Option.js';
import type { IActionContext } from '../../../Types/PipelineContext.js';
import type { HeaderMap } from '../IApiDirectScrapeShape.js';

/** Header naming one financial call, fresh per call. */
const TXN_ID_HEADER = 'X-FIBI-Transaction-Id';

/** Headers the portal page sends on every financial call. */
const PORTAL_HEADERS: HeaderMap = { Accept: 'application/json', 'User-Agent': FIBI_UA };

/** The session a context without an API mediator stands for. */
const NO_SESSION: SessionContext = {};

/**
 * The session the API mediator holds, or an empty one.
 * @param ctx - Action context carrying the API mediator.
 * @returns The session context.
 */
function sessionOf(ctx: IActionContext): SessionContext {
  if (!isSome(ctx.apiMediator)) return NO_SESSION;
  return ctx.apiMediator.value.getSessionContext();
}

/**
 * A session slot's text, or empty when the slot holds no text.
 * @param session - Session context.
 * @param slot - Slot name.
 * @returns The slot text, or an empty string.
 */
function textOf(session: SessionContext, slot: string): string {
  const value = session[slot];
  return typeof value === 'string' ? value : '';
}

/**
 * The page headers a landing URL names, or none when it is not a URL.
 * @param landingUrl - The landing URL the login kept.
 * @returns `Origin` and `Referer`, or an empty map.
 */
function pageHeaders(landingUrl: string): HeaderMap {
  if (!URL.canParse(landingUrl)) return {};
  const origin = new URL(landingUrl).origin;
  return { Origin: origin, Referer: landingUrl };
}

/**
 * Headers for one FIBI financial call.
 * @param ctx - Action context carrying the API mediator.
 * @returns A fresh transaction id, plus the portal headers on a headless session.
 */
export default function fibiCallHeaders(ctx: IActionContext): HeaderMap {
  const headers: HeaderMap = { [TXN_ID_HEADER]: randomUUID() };
  const session = sessionOf(ctx);
  const authorization = textOf(session, 'authorization');
  if (authorization === '') return headers;
  const landingUrl = textOf(session, 'landingUrl');
  const page = pageHeaders(landingUrl);
  return { ...headers, Authorization: authorization, ...PORTAL_HEADERS, ...page };
}
