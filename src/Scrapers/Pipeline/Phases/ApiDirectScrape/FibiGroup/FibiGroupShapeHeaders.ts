/**
 * FIBI group scrape shape — per-call request headers. Every financial call
 * sends a fresh `X-FIBI-Transaction-Id`, as the portal shell does. Once a
 * headless login has stored the portal-shell `authorization` answer (the
 * bank config's `sessionCarry`), every call also sends it verbatim as
 * `Authorization`. The browser path holds no such slot — its bus already
 * sends the sniffed header — so the shape adds none there.
 */

import { randomUUID } from 'node:crypto';

import { isSome } from '../../../Types/Option.js';
import type { IActionContext } from '../../../Types/PipelineContext.js';
import type { HeaderMap } from '../IApiDirectScrapeShape.js';

/** Header naming one financial call, fresh per call. */
const TXN_ID_HEADER = 'X-FIBI-Transaction-Id';

/**
 * The session's portal-shell authorization value, or empty when the
 * session holds none.
 * @param ctx - Action context carrying the API mediator.
 * @returns The authorization value, or an empty string.
 */
function authorizationOf(ctx: IActionContext): string {
  if (!isSome(ctx.apiMediator)) return '';
  const session = ctx.apiMediator.value.getSessionContext();
  const value = session.authorization;
  return typeof value === 'string' ? value : '';
}

/**
 * Headers for one FIBI financial call.
 * @param ctx - Action context carrying the API mediator.
 * @returns A fresh transaction id, plus the session authorization when held.
 */
export default function fibiCallHeaders(ctx: IActionContext): HeaderMap {
  const headers: HeaderMap = { [TXN_ID_HEADER]: randomUUID() };
  const authorization = authorizationOf(ctx);
  if (authorization === '') return headers;
  return { ...headers, Authorization: authorization };
}
