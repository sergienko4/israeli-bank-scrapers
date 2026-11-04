/**
 * Mizrahi constants shared by the login config and the scrape shape. Login
 * runs on the www host; the session handoff and every data call run on the
 * mto host, so both read the hosts and the header sets from here.
 */

/** Mizrahi web origin — the login page and the login API. */
const MIZRAHI_WEB = 'https://www.mizrahi-tefahot.co.il';

/** Mizrahi online-banking origin — the session handoff and the data API. */
const MIZRAHI_MTO = 'https://mto.mizrahi-tefahot.co.il';

/** The online-banking page the session handoff starts from. */
const MIZRAHI_LANDING_URL = `${MIZRAHI_MTO}/Online/Default.aspx?language=he-IL`;

/** Content type of every JSON call. */
const JSON_TYPE = 'application/json';

/**
 * Headers every call sends: a JSON accept and the library's own user agent.
 * Names are lowercase so they replace, rather than sit beside, the
 * transport's defaults.
 */
const MIZRAHI_STATIC_HEADERS: Readonly<Record<string, string>> = Object.freeze({
  accept: JSON_TYPE,
  'user-agent': 'israeli-bank-scrapers',
});

/** Headers a page load sends instead of the JSON accept. */
const MIZRAHI_DOCUMENT_HEADERS: Readonly<Record<string, string>> = Object.freeze({
  accept: 'text/html',
});

/** Headers a POST to the web host sends, as made from the login page. */
const MIZRAHI_WEB_POST_HEADERS: Readonly<Record<string, string>> = Object.freeze({
  origin: MIZRAHI_WEB,
  referer: `${MIZRAHI_WEB}/login/index.html`,
  'content-type': JSON_TYPE,
});

/** Headers a POST to the online-banking host sends, as made from its landing page. */
const MIZRAHI_MTO_POST_HEADERS: Readonly<Record<string, string>> = Object.freeze({
  origin: MIZRAHI_MTO,
  referer: MIZRAHI_LANDING_URL,
  'content-type': JSON_TYPE,
});

export {
  MIZRAHI_DOCUMENT_HEADERS,
  MIZRAHI_LANDING_URL,
  MIZRAHI_MTO,
  MIZRAHI_MTO_POST_HEADERS,
  MIZRAHI_STATIC_HEADERS,
  MIZRAHI_WEB,
  MIZRAHI_WEB_POST_HEADERS,
};
