/**
 * Yahav native call builders: the read body and the headers each BaNCS call
 * sends, built from the session state the earlier answers rotated.
 * The login sends empty session ids; every read sends the current ones.
 */

import { isRecord } from '../../../Mediator/Scrape/Bancs/BancsShape.js';
import type { HeaderMap, VarsMap } from '../../../Phases/ApiDirectScrape/IApiDirectScrapeShape.js';
import type { IActionContext } from '../../../Types/PipelineContext.js';
import { yahavReadBody } from './YahavNativeEnvelope.js';
import { NATIVE_EMPTY_SECTOKEN } from './YahavNativeEnvelopeStatic.js';
import { yahavNativeHeaders } from './YahavNativeHeaders.js';
import { sessionText, YAHAV_SESSION_KEYS, yahavSessionOf } from './YahavShapeHelpers.js';

/** A header builder bound to one call's path. */
type HeadersOf = (ctx: IActionContext) => HeaderMap;

/**
 * A read body carrying the session's token and CSRF token.
 * @param ctx - Action context.
 * @param path - BaNCS path of the read.
 * @param payload - Inquiry payload.
 * @returns Read body.
 */
function yahavReadVars(ctx: IActionContext, path: string, payload: VarsMap): VarsMap {
  const session = yahavSessionOf(ctx);
  const held = session[YAHAV_SESSION_KEYS.security];
  const security = isRecord(held) ? held : NATIVE_EMPTY_SECTOKEN;
  const csrf = sessionText(session, YAHAV_SESSION_KEYS.csrf);
  return yahavReadBody({ path, now: new Date(), state: { security, csrf }, payload });
}

/**
 * The login headers: the device id, no session ids yet.
 * @param path - BaNCS path of the login.
 * @param ctx - Action context.
 * @returns Header map.
 */
function loginHeaders(path: string, ctx: IActionContext): HeaderMap {
  const session = yahavSessionOf(ctx);
  const mag = sessionText(session, YAHAV_SESSION_KEYS.mag);
  return yahavNativeHeaders({ path, mag, session: '', xsrf: '' });
}

/**
 * The read headers: the device id and the current session ids.
 * @param path - BaNCS path of the read.
 * @param ctx - Action context.
 * @returns Header map.
 */
function readHeaders(path: string, ctx: IActionContext): HeaderMap {
  const held = yahavSessionOf(ctx);
  const mag = sessionText(held, YAHAV_SESSION_KEYS.mag);
  const session = sessionText(held, YAHAV_SESSION_KEYS.session);
  const xsrf = sessionText(held, YAHAV_SESSION_KEYS.xsrf);
  return yahavNativeHeaders({ path, mag, session, xsrf });
}

/**
 * Login headers bound to the login path.
 * @param path - BaNCS path of the login.
 * @returns Header builder.
 */
function yahavLoginHeaders(path: string): HeadersOf {
  return loginHeaders.bind(null, path);
}

/**
 * Read headers bound to one read's path.
 * @param path - BaNCS path of the read.
 * @returns Header builder.
 */
function yahavReadHeaders(path: string): HeadersOf {
  return readHeaders.bind(null, path);
}

export { yahavLoginHeaders, yahavReadHeaders, yahavReadVars };
