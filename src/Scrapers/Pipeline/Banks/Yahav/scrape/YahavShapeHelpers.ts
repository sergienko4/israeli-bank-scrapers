/**
 * Yahav native scrape shape — shared primitives.
 *
 * Every BaNCS call posts to one native origin. The session state the calls
 * rotate (the security token, the CSRF token and the two session ids) and the
 * portfolio the bootstrap resolves live in the mediator session-context under
 * the keys named here, beside the device's `mag-identifier` the login stored.
 */

import type { SessionContext } from '../../../Mediator/Api/ApiMediator.js';
import { resolveApiMediator } from '../../../Mediator/Api/ApiMediatorAccessor.js';
import { YAHAV_NATIVE_ORIGIN } from '../../../Registry/Config/PipelineBankConfigYahavConstants.js';
import { literalUrl, type WKUrlOrLiteral } from '../../../Registry/WK/UrlsWK.js';
import type { IActionContext } from '../../../Types/PipelineContext.js';
import { isOk } from '../../../Types/Procedure.js';
import type { IYahavNativeRef } from './YahavNativePayloads.js';

/** Label the shape's mediator lookups carry. */
const SCRAPE_LABEL = 'YahavScrape';

/** Session-context keys the native shape reads and writes. */
const YAHAV_SESSION_KEYS = Object.freeze({
  security: 'security',
  csrf: 'csrf',
  session: 'session',
  xsrf: 'xsrf',
  portfolioId: 'portfolioId',
  portfolioIorId: 'portfolioIorId',
  mag: 'mag',
});

/** A current account: its BaNCS ids and, when the bank sends it, its number. */
interface IYahavAcct extends IYahavNativeRef {
  readonly number?: string;
}

/**
 * The mediator session-context, or empty before the mediator exists.
 * @param ctx - Action context.
 * @returns Session snapshot.
 */
function yahavSessionOf(ctx: IActionContext): SessionContext {
  const mediator = resolveApiMediator(ctx, SCRAPE_LABEL);
  if (!isOk(mediator)) return {};
  return mediator.value.getSessionContext();
}

/**
 * One session value as text, empty when absent or not text.
 * @param session - Session snapshot.
 * @param key - Session-context key.
 * @returns The text value.
 */
function sessionText(session: SessionContext, key: string): string {
  const value = session[key];
  return typeof value === 'string' ? value : '';
}

/**
 * The portfolio the bootstrap resolved.
 * @param ctx - Action context.
 * @returns Portfolio reference.
 */
function yahavPortfolioOf(ctx: IActionContext): IYahavNativeRef {
  const session = yahavSessionOf(ctx);
  const id = sessionText(session, YAHAV_SESSION_KEYS.portfolioId);
  const iorId = sessionText(session, YAHAV_SESSION_KEYS.portfolioIorId);
  return { id, iorId };
}

/**
 * The absolute URL of a BaNCS path on the native origin.
 * @param path - BaNCS path.
 * @returns Literal URL.
 */
function yahavCallUrl(path: string): WKUrlOrLiteral {
  return literalUrl(`${YAHAV_NATIVE_ORIGIN}${path}`);
}

export type { IYahavAcct };
export {
  SCRAPE_LABEL,
  sessionText,
  YAHAV_SESSION_KEYS,
  yahavCallUrl,
  yahavPortfolioOf,
  yahavSessionOf,
};
