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
 *   D1 — Frame inventory + main URL on cross-origin postMessage failure
 *   D2 — Un-truncated postMessage origins (cap widened 120 → 300)
 */

import type { ConsoleMessage, Page } from 'playwright-core';

import type { ScraperLogger } from '../../../Types/Debug.js';

/** Console types that warrant forensic capture; log/info/debug are noise. */
const EMIT_CONSOLE_TYPES = new Set(['error', 'warning']);

/**
 * Replace digit-runs of ≥ 4 chars with '#' and cap to 300 chars.
 * @param text - Raw text to scrub.
 * @returns PII-safe text (digit-runs ≥ 4 replaced with '#', capped at 300 chars).
 */
function scrub(text: string): string {
  return text.replaceAll(/\d{4,}/g, '#').slice(0, 300);
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
 * Parse host + pathname from a URL string without query or fragment.
 * Answers "what page was the main frame on?" without leaking search params.
 * @param url - Raw URL string.
 * @returns host+pathname, or '(opaque)' on failure.
 */
function hostPathOf(url: string): string {
  try {
    const { host, pathname } = new URL(url);
    return host + pathname;
  } catch {
    return '(opaque)';
  }
}

/** Return type alias: ConsoleMessage → boolean handler. */
type ConsoleHandler = (msg: ConsoleMessage) => boolean;

/**
 * Collect deduplicated host strings from every frame attached to the page.
 * Mirrors the captureFrameTree never-throws contract in PageObservers.ts.
 * @param page - Playwright page.
 * @returns Readonly array of unique host strings.
 */
function dedupeFrameHosts(page: Page): readonly string[] {
  try {
    return [...new Set(page.frames().map(frameToHost))];
  } catch {
    return [];
  }
}

/**
 * Extract the safe host from a single Playwright frame.
 * Extracted from dedupeFrameHosts to avoid a FORBIDDEN NESTED CALL.
 * @param f - Frame or frame-like with a url() accessor.
 * @param f.url - Accessor that returns the frame's URL string.
 * @returns Safe host string.
 */
function frameToHost(f: { url(): string }): string {
  const url = f.url();
  return safeHostOf(url);
}

/**
 * Return true when the scrubbed console text looks like a cross-origin
 * postMessage rejection. Case-insensitive match for both markers.
 * @param textScrubbed - Already-scrubbed console text.
 * @returns True when both 'postmessage' and 'target origin' are present.
 */
function isPostMessageError(textScrubbed: string): boolean {
  const lower = textScrubbed.toLowerCase();
  return lower.includes('postmessage') && lower.includes('target origin');
}

/** Mutable flag — mutated inside a per-handler closure; never shared. */
interface IConsoleHandlerState {
  framesEmitted: boolean;
}

/** Bundled immutable context for the emit helper (≤ 3 params). */
interface IHandlerEmitCtx {
  readonly state: IConsoleHandlerState;
  readonly logger: ScraperLogger;
  readonly page: Page;
}

/**
 * Emit the one-shot login.frames snapshot when this is the first
 * cross-origin postMessage error seen in this login session.
 * @param ctx - Immutable context bundle.
 * @param textScrubbed - Already-scrubbed console text to test.
 * @returns True when the snapshot was emitted; false when skipped.
 */
function emitFrameSnapshotOnce(ctx: IHandlerEmitCtx, textScrubbed: string): boolean {
  if (ctx.state.framesEmitted || !isPostMessageError(textScrubbed)) return false;
  ctx.state.framesEmitted = true;
  const pageUrl = ctx.page.url();
  const mainUrl = hostPathOf(pageUrl);
  const hosts = dedupeFrameHosts(ctx.page);
  ctx.logger.debug({ event: 'login.frames', mainUrl, hosts });
  return true;
}

/**
 * Emit the login.console trace line and the one-shot frame snapshot.
 * Extracted from buildHandlerCallback to keep that function ≤10 lines.
 * @param ctx - Shared handler context.
 * @param type - Console message type string.
 * @param textScrubbed - PII-safe scrubbed text.
 * @returns True after emitting.
 */
function emitConsoleTrace(ctx: IHandlerEmitCtx, type: string, textScrubbed: string): true {
  ctx.logger.debug({ event: 'login.console', type, textScrubbed });
  emitFrameSnapshotOnce(ctx, textScrubbed);
  return true;
}

/**
 * Build the inner console-event callback bound to the shared ctx.
 * Extracted so buildConsoleHandler stays ≤ 3 body statements.
 * @param ctx - Shared context (state + logger + page).
 * @returns Playwright ConsoleMessage listener.
 */
function buildHandlerCallback(ctx: IHandlerEmitCtx): ConsoleHandler {
  return (msg: ConsoleMessage): boolean => {
    const type = msg.type();
    if (!EMIT_CONSOLE_TYPES.has(type)) return false;
    const text = msg.text();
    const textScrubbed = scrub(text);
    emitConsoleTrace(ctx, type, textScrubbed);
    return true;
  };
}

/**
 * Build a console-message listener that emits gated forensic trace.
 * Only 'error' and 'warning' types are emitted; log/info/debug are silenced.
 * D1: On the FIRST cross-origin postMessage error, emits one login.frames
 *   snapshot with the frame-host inventory and the main-frame host+path.
 * D2: scrub cap widened to 300 so BOTH postMessage origin strings survive.
 * @param logger - Pipeline logger.
 * @param page - Playwright page (used for frame inventory in D1).
 * @returns Playwright ConsoleMessage listener.
 */
export function buildConsoleHandler(logger: ScraperLogger, page: Page): ConsoleHandler {
  const state: IConsoleHandlerState = { framesEmitted: false };
  const ctx: IHandlerEmitCtx = { state, logger, page };
  return buildHandlerCallback(ctx);
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
