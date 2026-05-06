/** Mock route handler — picks HTML body per request (frame > phase > last > placeholder) and builds Playwright fulfil callback. */

import * as fs from 'node:fs';

import type { Request, Route } from 'playwright-core';

import type { Brand } from '../Types/Brand.js';
import { getDebug } from '../Types/Debug.js';
import type { IMockState } from './MockInterceptorIO.js';
import { resolveMockHtml } from './MockInterceptorIO.js';
import { frameFilenameForUrl, frameFilePath } from './SnapshotFrameCapture.js';

/** URL-looks-like-iframe predicate. */
type LooksLikeIframe = Brand<boolean, 'LooksLikeIframe'>;
/** Hint-substring match predicate. */
type IsHintMatch = Brand<boolean, 'IsHintMatch'>;
/** Trace-emit outcome. */
type DidTraceMiss = Brand<boolean, 'DidTraceMiss'>;
/** HTML body served for a request (or empty fall-through). */
type MockHtmlBody = Brand<string, 'MockHtmlBody'>;
/** HTML body with normalizer injected. */
type NormalizedHtml = Brand<string, 'NormalizedHtml'>;

const LOG = getDebug(import.meta.url);

/** URL patterns we treat as iframe candidates — parent HTML declares them via <iframe src=...>. */
const IFRAME_URL_HINTS = ['Servlet', 'iframe', 'embed', 'Matrix'];

/**
 * Heuristic: does this URL look like an iframe load we expected to capture?
 * Used only to decide whether a miss is worth surfacing at info level.
 * @param url - Requested URL.
 * @returns True for URLs that likely target a child frame.
 */
function looksLikeIframeUrl(url: string): LooksLikeIframe {
  return IFRAME_URL_HINTS.some(
    (hint): IsHintMatch => url.includes(hint) as IsHintMatch,
  ) as LooksLikeIframe;
}

/**
 * Emit an info-level trace when a likely-iframe URL has no captured file.
 * Operators use this to hand-link Beinleumi-style re-attached frames.
 * @param companyId - Bank identifier.
 * @param url - Requested URL (miss).
 * @returns True after the trace, false when URL isn't iframe-ish.
 */
function traceFrameMiss(companyId: string, url: string): DidTraceMiss {
  if (!looksLikeIframeUrl(url)) return false as DidTraceMiss;
  const expectedFile = frameFilenameForUrl(url);
  const relPath = `${companyId}/frames/${expectedFile}`;
  LOG.info({ message: `mock: iframe snapshot MISS — ${relPath} missing for ${url}` });
  return true as DidTraceMiss;
}

/**
 * Try to serve a saved iframe snapshot keyed by the request URL. On miss,
 * trace-log the expected file path so operators can hand-link a captured
 * frame when a bank's SPA detaches/recreates its iframe.
 * @param companyId - Bank identifier.
 * @param url - Requested URL.
 * @returns Frame HTML or empty string when no per-frame file exists.
 */
function tryServeFrameHtml(companyId: string, url: string): MockHtmlBody {
  const file = frameFilePath(companyId, url);
  try {
    return fs.readFileSync(file, 'utf8') as MockHtmlBody;
  } catch {
    traceFrameMiss(companyId, url);
    return '' as MockHtmlBody;
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
function injectNormalizer(html: string): NormalizedHtml {
  if (!html) return html as NormalizedHtml;
  return html.replace(
    HEAD_OPEN_RE,
    (match): NormalizedHtml => `${match}${NORMALIZER_CSS}` as NormalizedHtml,
  ) as NormalizedHtml;
}

/**
 * Pick the best HTML body for this request. Updates state.lastServed on
 * phase-snapshot hits so subsequent requests get the same body. For
 * sub-frame requests with no captured snapshot we return empty — falling
 * through to phase HTML pollutes 3rd-party telemetry iframes (Wix,
 * doubleclick, panorama) with a 3.7MB copy of home.html and breaks
 * hydration of the parent page.
 * @param companyId - Bank identifier.
 * @param state - Mutable state tracking the active phase.
 * @param request - Incoming Playwright request (used for frame detection).
 * @returns HTML to fulfil with (normalizer injected).
 */
function pickHtmlForRequest(
  companyId: string,
  state: IMockState,
  request: Request,
): NormalizedHtml {
  const url = request.url();
  const frameHtml = tryServeFrameHtml(companyId, url);
  if (frameHtml) return injectNormalizer(frameHtml);
  const isMainFrame = !request.frame().parentFrame();
  if (!isMainFrame) return '' as NormalizedHtml;
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
  companyId: string,
  state: IMockState,
): (route: Route, request: Request) => Promise<boolean> {
  return async (route: Route, request: Request): Promise<boolean> => {
    const body = pickHtmlForRequest(companyId, state, request);
    await route.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body });
    return true;
  };
}

export default buildHandler;
