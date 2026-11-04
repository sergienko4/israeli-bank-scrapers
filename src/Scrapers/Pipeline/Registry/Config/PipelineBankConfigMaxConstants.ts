/**
 * Max constants shared by the login config and the scrape shape. The web
 * app sends the same header set on every call, login and data alike, so
 * both read it from here.
 */

/** Max web origin — the login API and the registered data API both live here. */
const MAX_ORIGIN = 'https://www.max.co.il';

/** User agent of the desktop browser the web app's calls were captured from. */
const MAX_USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:135.0) Gecko/20100101 Firefox/135.0';

/**
 * Headers the web app sends on every call. The per-call `sid` and `cid` are
 * added by the caller; `urf` and `cav` are sent empty, as the app does before
 * it has a referrer or a build version. Names are lowercase so they replace,
 * rather than sit beside, the transport's defaults.
 */
const MAX_STATIC_HEADERS: Readonly<Record<string, string>> = Object.freeze({
  accept: 'application/json',
  'accept-language': 'he-IL,he;q=0.9',
  origin: MAX_ORIGIN,
  referer: `${MAX_ORIGIN}/login`,
  'user-agent': MAX_USER_AGENT,
  urf: '',
  cav: '',
});

export { MAX_ORIGIN, MAX_STATIC_HEADERS };
