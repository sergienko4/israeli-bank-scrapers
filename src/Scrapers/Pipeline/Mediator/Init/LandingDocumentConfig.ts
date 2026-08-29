/**
 * Landing-document policy for the INIT navigation.
 *
 * <p>Why this exists alongside {@link "./LandingStatusConfig.js"}. That
 * policy judges the landing by its HTTP status, which is the right test
 * when the edge tells the truth. Discount's does not: its F5 edge serves
 * the bank's own branded 404 document under HTTP 200, so the status gate
 * is structurally unable to see it. INIT passed the dead page as healthy
 * and the run failed three phases later at HOME with "no login nav link
 * found" — accurate, and unattributable. There was no login link because
 * there was no homepage. Confirmed live on 2026-08-29: a request for a
 * non-existent path under that host answers `200` with a 37 KB body whose
 * only heading is `<h1>404</h1>` and whose `<title>` is empty.
 *
 * <p>Why an empty title is not the signal. The INIT POST gate already
 * classifies Firefox's own error chrome by title, and this document's
 * title is empty, so that gate passes it. Failing on a blank title (or on
 * a low element count) would reach all 19 banks for a symptom none of
 * them owns; the diagnosis rejected both for that reason.
 */

import type { Brand } from '../../Types/Brand.js';

/** Whether the landed document is a server-rendered error page. */
export type IsErrorDocument = Brand<boolean, 'IsErrorDocument'>;

/** PII-safe INIT failure message naming an error document. */
export type ErrorDocumentText = Brand<string, 'ErrorDocumentText'>;

/**
 * Stable code identifying the error-document failure.
 *
 * <p>Front-loaded into the message for two reasons. The reducer matches
 * on it to suppress the sanitization pulse — re-running INIT would
 * re-enter the non-idempotent browser launch for a condition the
 * evidence says clears in minutes, not seconds. And the stage logger
 * truncates messages to 30 characters, so anything that must survive
 * into the phase log has to come first.
 */
export const INIT_ERROR_DOCUMENT_CODE = 'INIT_ERROR_DOCUMENT';

/**
 * Deadline for the heading count, after which the probe reports none.
 *
 * <p>Playwright dispatches `queryCount` with its no-timeout sentinel, so
 * the call inherits no page or context deadline: against a renderer that
 * stops answering after `domcontentloaded` the promise never settles,
 * and a `catch` cannot rescue a promise that never rejects. This bounds
 * the one new operation the probe adds to every browser bank's success
 * path. Generous relative to a local DOM query, which takes single-digit
 * milliseconds, so it expires only when the renderer is genuinely wedged.
 */
export const ERROR_HEADING_COUNT_TIMEOUT_MS = 5_000;

/**
 * Regex source for a heading that is nothing but an HTTP error status.
 *
 * <p>Deliberately free of backslash escapes. The source travels inside a
 * Playwright selector string, whose own parser processes escapes first,
 * so `\s` and `\d` would be at the mercy of two grammars. `[0-9]` and a
 * literal space class survive both. Playwright normalises element text
 * before matching, which covers the newlines and indentation a `<h1>` is
 * usually wrapped in.
 *
 * <p>Anchored on both ends so only a bare code matches: an error page's
 * `<h1>404</h1>` does, a marketing heading that merely mentions one does
 * not. 3xx is excluded — a redirect never renders.
 */
export const ERROR_CODE_PATTERN = '^[ ]*[45][0-9]{2}[ ]*$';

/**
 * Selector for a *rendered* status-code heading, checked at both `h1`
 * and `h2` because error templates disagree about which level the code
 * belongs at.
 *
 * <p>`:visible` is load-bearing, not decoration. A bare `count()` also
 * counts elements the user never sees, and shipping a dormant error
 * template or an off-screen carousel slide in the markup is ordinary
 * practice — either would fail a healthy bank. Requiring the heading to
 * be rendered removes that whole class of false positive, and costs
 * nothing on the true positive: the document that motivated this probe
 * displays its `<h1>404</h1>`.
 *
 * <p>Measured before it was trusted on the success path: run through the
 * real Playwright selector engine against every captured page fixture in
 * `src/Tests/Integration/fixtures/banks`, it matched nothing, and against
 * the live-captured Discount error document it matched once.
 *
 * <p>Scope is deliberately narrow — it recognises the captured "bare
 * status heading" template in the main frame. A code rendered as an
 * image, split across child elements, sunk into a `div`, or confined to
 * a subframe is out of scope by design: broadening the net without
 * fixtures to measure it against would trade a rare miss for a
 * success-path false positive, which is the worse failure.
 */
export const ERROR_HEADING_SELECTOR =
  `h1:visible:text-matches("${ERROR_CODE_PATTERN}"), ` +
  `h2:visible:text-matches("${ERROR_CODE_PATTERN}")`;
