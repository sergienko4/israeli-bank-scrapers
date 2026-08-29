/**
 * Landing-document classification for the INIT navigation.
 *
 * <p>Read-only companion to {@link "./LandingStatus.js"}: that module
 * judges the landing by the status the edge reported, this one by the
 * document the edge actually served. Runs at INIT FINAL, immediately
 * after the DOM gate and before anything is wired, so a mediator and a
 * `loginUrl` are never built from an error page.
 *
 * <p>Placed at FINAL rather than POST on purpose. `page.goto` commits at
 * headers (`waitUntil: 'commit'`), so at POST the body may not be parsed
 * yet and the probe would silently miss. FINAL has already awaited
 * `domcontentloaded` and failed the phase otherwise, so the document is
 * guaranteed parsed there — the probe costs no extra wait and no extra
 * latency.
 */

import { redactUrlFull } from '../../Types/PiiRedactor/Url.js';
import { RACE_TIMED_OUT, raceTimeout } from '../Timing/TimingActions.js';
import type { ErrorDocumentText, IsErrorDocument } from './LandingDocumentConfig.js';
import {
  ERROR_HEADING_COUNT_TIMEOUT_MS,
  ERROR_HEADING_SELECTOR,
  INIT_ERROR_DOCUMENT_CODE,
} from './LandingDocumentConfig.js';

/** Read-only count of the elements a selector matches. */
interface ILandingLocator {
  count(): Promise<number>;
}

/**
 * Minimal read-only surface this probe needs from a page.
 *
 * <p>Narrowed to the one method used so the probe can be exercised
 * without a browser, and so a future move to the element mediator is a
 * change of adapter rather than a change of logic. Playwright's `Page`
 * satisfies it structurally.
 */
interface ILandingDocumentSource {
  locator(selector: string): ILandingLocator;
}

/**
 * Start the count and neutralise its rejection for the losing race.
 *
 * <p>The deadline below may abandon this promise. An abandoned promise
 * that rejects later — which is exactly what happens when the page is
 * closed during teardown — is an unhandled rejection that can take the
 * process down. Attaching the handler here, at creation, means the
 * promise is never unobserved.
 *
 * @param source - Page-shaped handle providing the selector count.
 * @returns Count promise that resolves to 0 instead of rejecting.
 */
function startCount(source: ILandingDocumentSource): Promise<number> {
  const pending = source.locator(ERROR_HEADING_SELECTOR).count();
  return pending.catch((): number => 0);
}

/**
 * Count the matching headings, treating any driver refusal as none.
 *
 * <p>Three ways this call can fail to produce a number, and all three
 * mean "no": `locator` can throw synchronously on a disposed channel,
 * `count` can reject, and `count` can hang forever because Playwright
 * dispatches it with no timeout. This runs on the INIT success path of
 * every bank, so an escaping throw — or a hang — would be worse than the
 * bug being fixed: the first turns a healthy landing into a phantom
 * wiring failure, the second wedges the phase indefinitely.
 *
 * @param source - Page-shaped handle providing the selector count.
 * @returns Number of matching headings, or 0 when unavailable.
 */
async function countErrorHeadings(source: ILandingDocumentSource): Promise<number> {
  try {
    const pending = startCount(source);
    const counted = await raceTimeout(ERROR_HEADING_COUNT_TIMEOUT_MS, pending);
    return counted === RACE_TIMED_OUT ? 0 : counted;
  } catch {
    return 0;
  }
}

/**
 * Report whether the landed document is a server-rendered error page.
 *
 * <p>Structural CSS is used deliberately: this reads the document, it
 * never drives it, which is the parsing/extraction exception in
 * `CLAUDE.md` rather than the interaction rule. Silence is always the
 * fallback — a miss leaves every existing failure mode exactly as it
 * was, while a false positive would fail a healthy run.
 *
 * @param source - Page-shaped handle for the committed document.
 * @returns True when a bare status-code heading is present.
 */
export async function isErrorDocument(source: ILandingDocumentSource): Promise<IsErrorDocument> {
  const count = await countErrorHeadings(source);
  return (count > 0) as IsErrorDocument;
}

/**
 * Build the INIT failure message for a landing that served an error
 * document.
 *
 * <p>Leads with {@link INIT_ERROR_DOCUMENT_CODE}: the reducer matches on
 * it to suppress the retry pulse, and the stage logger truncates to 30
 * characters, so anything that must survive into the phase log has to
 * come first. Redaction happens here rather than at the call site so
 * every caller gets a PII-safe message by construction.
 *
 * @param currentUrl - Raw landing URL; redacted before it is embedded.
 * @returns Human-readable, PII-safe failure message.
 */
export function errorDocumentMessage(currentUrl: string): ErrorDocumentText {
  const safeUrl = redactUrlFull(currentUrl);
  const reason = 'bank edge served an error document, not the bank page';
  const text = `${INIT_ERROR_DOCUMENT_CODE}: ${reason} (${safeUrl})`;
  return text as ErrorDocumentText;
}

export type { ILandingDocumentSource };
