/**
 * Login forensic trace handlers — console, pageerror, and popup capture.
 *
 * All three builders produce listeners attached ONLY inside the
 * PIPELINE_AUTH_REQ_TRACE gate in Factory.ts. When the gate is OFF
 * (production default) none of these handlers are created or attached,
 * preserving byte-identical browser fingerprint.
 *
 * Answers the two Amex CI fork diagnostics:
 *   Fork A — Angular submit throws before XHR: login.console / login.pageerror
 *   Fork B — XHR egresses on detached target: login.target.new
 */

import type { ConsoleMessage, Page } from 'playwright-core';

import type { ScraperLogger } from '../../../Types/Debug.js';

/** Console types that warrant forensic capture; log/info/debug are noise. */
const EMIT_CONSOLE_TYPES = new Set(['error', 'warning']);

/**
 * Replace digit-runs of ≥ 4 chars with '#' and cap to 120 chars.
 * @param text - Raw text to scrub.
 * @returns PII-safe text.
 */
function scrub(text: string): string {
  return text.replaceAll(/\d{4,}/g, '#').slice(0, 120);
}

/**
 * Parse the host from a URL string; return '(opaque)' on empty host or failure.
 * Tolerates about:blank (empty host) and any unparseable URL without throwing.
 * @param url - Raw URL string.
 * @returns Host component or the sentinel '(opaque)'.
 */
function safeHostOf(url: string): string {
  try {
    const { host } = new URL(url);
    return host || '(opaque)';
  } catch {
    return '(opaque)';
  }
}

/**
 * Build a console-message listener that emits gated forensic trace.
 * Only 'error' and 'warning' types are emitted; log/info/debug are silenced.
 * @param logger - Pipeline logger.
 * @returns Playwright ConsoleMessage listener.
 */
export function buildConsoleHandler(logger: ScraperLogger): (msg: ConsoleMessage) => boolean {
  return (msg: ConsoleMessage): boolean => {
    const type = msg.type();
    if (!EMIT_CONSOLE_TYPES.has(type)) return false;
    const text = msg.text();
    const textScrubbed = scrub(text);
    logger.debug({ event: 'login.console', type, textScrubbed });
    return true;
  };
}

/**
 * Build a page-error listener that emits gated forensic trace.
 * Emits name and scrubbed message only; never logs stack traces (PII risk).
 * @param logger - Pipeline logger.
 * @returns Page-error listener.
 */
export function buildPageErrorHandler(logger: ScraperLogger): (err: Error) => boolean {
  return (err: Error): boolean => {
    const msgScrubbed = scrub(err.message);
    logger.debug({ event: 'login.pageerror', name: err.name, msgScrubbed });
    return true;
  };
}

/**
 * Build a popup-page listener that emits gated forensic trace.
 * Emits host-only; tolerates about:blank and unparseable URLs via safeHostOf.
 * @param logger - Pipeline logger.
 * @returns Page listener (bound to BrowserContext 'page' event).
 */
export function buildPopupHandler(logger: ScraperLogger): (popup: Page) => boolean {
  return (popup: Page): boolean => {
    const popupUrl = popup.url();
    const host = safeHostOf(popupUrl);
    logger.debug({ event: 'login.target.new', host });
    return true;
  };
}
