/**
 * HOME error-document probe — read-only classification of the landed page.
 *
 * <p>Written for a failure that cost a forensic download to explain. Discount's
 * edge served the bank's own branded 404 for the homepage, but served it under
 * HTTP 200. {@link ../Init/LandingStatusConfig.js} judges the landing by status
 * and 200 is healthy, so INIT passed it, and the run failed three phases later
 * at HOME with "no login nav link found" — accurate, and unattributable. There
 * was no login link because there was no homepage.
 *
 * <p>This probe closes the attribution gap at the only place it can be closed
 * without risking a healthy run: the path that has already failed. It never
 * decides whether a phase passes, only what the failure is allowed to say.
 */

import type { IElementMediator } from '../Elements/ElementMediator.js';

/**
 * Regex source for a heading that is nothing but an HTTP error status.
 *
 * <p>Deliberately free of backslash escapes. The source travels inside a
 * Playwright selector string, whose own parser processes escapes first, so
 * `\s` and `\d` would be at the mercy of two grammars. `[0-9]` and a literal
 * space class survive both. Playwright normalizes element text before matching,
 * which covers the newlines and indentation a `<h1>` is usually wrapped in.
 *
 * <p>Anchored on both ends so only a bare code matches: an error page's
 * `<h1>404</h1>` does, a marketing heading that merely mentions one does not.
 * 3xx is excluded — a redirect never renders.
 */
const ERROR_CODE_PATTERN = '^[ ]*[45][0-9]{2}[ ]*$';

/**
 * Selector for a status-code heading, checked at both `h1` and `h2` because
 * error templates disagree about which level the code belongs at.
 */
const ERROR_HEADING_SELECTOR =
  `h1:text-matches("${ERROR_CODE_PATTERN}"), ` + `h2:text-matches("${ERROR_CODE_PATTERN}")`;

/**
 * Report whether the current document looks like a server-rendered error page.
 *
 * <p>Structural CSS is used deliberately: this reads the document, it never
 * drives it, which is the parsing/extraction exception in CLAUDE.md rather than
 * the interaction rule. A false negative simply leaves the original message in
 * place, so the probe stays silent whenever it cannot be certain.
 * @param mediator - Element mediator providing the read-only selector count.
 * @returns True when a bare status-code heading is present.
 */
async function isErrorDocument(mediator: IElementMediator): Promise<boolean> {
  const count = await mediator.countBySelector(ERROR_HEADING_SELECTOR).catch((): number => 0);
  return count > 0;
}

/**
 * Build the failure message for a landing that produced an error document.
 *
 * <p>Keeps the `HOME PRE:` prefix so existing log greps and dashboards keep
 * matching, and names the URL so the cause is legible from the message alone.
 * @param url - URL the page reports itself to be on.
 * @returns Attributed HOME PRE failure message.
 */
function errorDocumentMessage(url: string): string {
  return `HOME PRE: ${url} served an error document, not the bank homepage (no login nav link)`;
}

export { ERROR_CODE_PATTERN, errorDocumentMessage, isErrorDocument };
