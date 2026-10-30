/**
 * Ring scrape shape — per-call request headers. Every ring data call sends
 * the static set the login steps send, the session's `bcKey` and a fresh
 * `traceidentifier`. The login steps carry these through `staticHeaders` and
 * step `headers`, which do not reach the scrape phase, so the shape rebuilds
 * them. `bcKey` is read from the session context, which holds the post-login
 * carry snapshot.
 */

import { randomUUID } from 'node:crypto';

import {
  type IRingConstants,
  ringStaticHeaders,
} from '../../../Registry/Config/PipelineBankConfigRingConstants.js';
import { isSome } from '../../../Types/Option.js';
import type { IActionContext } from '../../../Types/PipelineContext.js';
import type { HeaderMap } from '../IApiDirectScrapeShape.js';

/** Headers builder handed to every ring scrape step. */
export type RingHeaders = (ctx: IActionContext) => HeaderMap;

/**
 * The session's `bcKey`, or an empty value before login has stored one.
 * The ring then answers `Header.Status -2`, which the shape's body check
 * turns into a failed call.
 * @param ctx - Action context carrying the API mediator.
 * @returns The bcKey, or an empty string.
 */
function bcKeyOf(ctx: IActionContext): string {
  if (!isSome(ctx.apiMediator)) return '';
  const session = ctx.apiMediator.value.getSessionContext();
  const bcKey = session.bcKey;
  return typeof bcKey === 'string' ? bcKey : '';
}

/**
 * Build the headers function for one ring issuer.
 * @param ring - The issuer's ring constants.
 * @returns Headers function: static set + bcKey + a fresh trace id.
 */
export function buildRingHeaders(ring: IRingConstants): RingHeaders {
  const statics = ringStaticHeaders(ring);
  return (ctx: IActionContext): HeaderMap => {
    const bckey = bcKeyOf(ctx);
    return { ...statics, bckey, traceidentifier: randomUUID() };
  };
}
