/** Mock route handler — picks HTML body per request (frame > phase > last > placeholder) and builds Playwright fulfil callback. */

import * as fs from 'node:fs';

import type { Request, Route } from 'playwright-core';

import { getDebug } from '../Types/Debug.js';
import type { IMockState } from './MockInterceptorIO.js';
import { resolveMockHtml } from './MockInterceptorIO.js';
import { frameFilenameForUrl, frameFilePath } from './SnapshotFrameCapture.js';

const LOG = getDebug(import.meta.url);

/** Route handler outcome — true after fulfilment. */
type RouteResult = boolean;
/** Whether a URL looks like an iframe load we expect to have captured. */
type LooksLikeIframe = boolean;
/** Bank identifier — string alias for clarity in handler signatures. */
type CompanyId = string;
/** Fully-qualified request URL. */
type RequestUrl = string;
/** HTML body served to a route request. */
type ResponseHtml = string;

/** URL patterns we treat as iframe candidates — parent HTML declares them via <iframe src=...>. */
const IFRAME_URL_HINTS = ['Servlet', 'iframe', 'embed', 'Matrix'];

/**
 * Heuristic: does this URL look like an iframe load we expected to capture?
 * Used only to decide whether a miss is worth surfacing at info level.
 * @param url - Requested URL.
 * @returns True for URLs that likely target a child frame.
 */
function looksLikeIframeUrl(url: RequestUrl): LooksLikeIframe {
  return IFRAME_URL_HINTS.some((hint): LooksLikeIframe => url.includes(hint));
}

/**
 * Emit an info-level trace when a likely-iframe URL has no captured file.
 * Operators use this to hand-link Beinleumi-style re-attached frames.
 * @param companyId - Bank identifier.
 * @param url - Requested URL (miss).
 * @returns True after the trace, false when URL isn't iframe-ish.
 */
function traceFrameMiss(companyId: CompanyId, url: RequestUrl): LooksLikeIframe {
  if (!looksLikeIframeUrl(url)) return false;
  const expectedFile = frameFilenameForUrl(url);
  const relPath = `${companyId}/frames/${expectedFile}`;
  LOG.info({ message: `mock: iframe snapshot MISS — ${relPath} missing for ${url}` });
  return true;
}

/**
 * Try to serve a saved iframe snapshot keyed by the request URL. On miss,
 * trace-log the expected file path so operators can hand-link a captured
 * frame when a bank's SPA detaches/recreates its iframe.
 * @param companyId - Bank identifier.
 * @param url - Requested URL.
 * @returns Frame HTML or empty string when no per-frame file exists.
 */
function tryServeFrameHtml(companyId: CompanyId, url: RequestUrl): ResponseHtml {
  const file = frameFilePath(companyId, url);
  try {
    return fs.readFileSync(file, 'utf8');
  } catch {
    traceFrameMiss(companyId, url);
    return '';
  }
}

/**
 * Global Layout Normalizer — neutralises JS-state-dependent hide tricks
 * (visibility/opacity/transform/clip) so elements stay hit-testable in
 * mock replay. Un-hides inline/attribute-based hiding and a Firefox-only
 * flattener for interactive shells. Injected after inlined-recorder CSS.
 */
const NORMALIZER_CSS = [
  '<style data-mock-normalizer="1">',
  '* { visibility: visible !important; opacity: 1 !important;',
  ' pointer-events: auto !important; transition: none !important;',
  ' animation: none !important; transform: none !important;',
  ' clip: auto !important; clip-path: none !important; }',
  'html, body { overflow: visible !important; }',
  '[style*="display: none"], [style*="display:none"], [hidden],',
  ' [aria-hidden="true"] { display: revert !important; }',
  '@-moz-document url-prefix() { a, nav, header, button, form, [role="button"]',
  ' { display: revert !important; position: static !important; } }',
  '</style>',
].join('');

/** Regex matching the opening `<head>` tag with any attributes. */
const HEAD_OPEN_RE = /<head(?:\s[^>]*)?>/i;

/**
 * Inject the normalizer style block immediately after the `<head>` tag so
 * it applies to every mock-served HTML response. No-op when the body has
 * no `<head>` (e.g. placeholder HTML).
 * @param html - Source HTML body.
 * @returns HTML with normalizer prepended inside `<head>`.
 */
function injectNormalizer(html: ResponseHtml): ResponseHtml {
  if (!html) return html;
  return html.replace(HEAD_OPEN_RE, (match): ResponseHtml => `${match}${NORMALIZER_CSS}`);
}

/**
 * Pick the best HTML body for this request. Updates state.lastServed on
 * phase-snapshot hits so subsequent requests get the same body.
 * @param companyId - Bank identifier.
 * @param state - Mutable state tracking the active phase.
 * @param url - Requested URL.
 * @returns HTML to fulfil with (normalizer injected).
 */
function pickHtmlForRequest(
  companyId: CompanyId,
  state: IMockState,
  url: RequestUrl,
): ResponseHtml {
  const frameHtml = tryServeFrameHtml(companyId, url);
  if (frameHtml) return injectNormalizer(frameHtml);
  const phaseHtml = resolveMockHtml(companyId, state.currentPhase, state.lastServed);
  state.lastServed = phaseHtml;
  return injectNormalizer(phaseHtml);
}

/**
 * Build the fulfil handler that serves phase-appropriate HTML.
 * Per-frame URL matches take priority — see pickHtmlForRequest.
 * @param companyId - Bank identifier.
 * @param state - Mutable state tracking the active phase.
 * @returns Route handler for page.route.
 */
export function buildHandler(
  companyId: CompanyId,
  state: IMockState,
): (route: Route, request: Request) => Promise<RouteResult> {
  return async (route: Route, request: Request): Promise<RouteResult> => {
    const url = request.url();
    const body = pickHtmlForRequest(companyId, state, url);
    await route.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body });
    return true;
  };
}

export default buildHandler;
