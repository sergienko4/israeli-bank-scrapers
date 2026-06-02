/**
 * Frame Registry — private contextId-based frame resolution.
 * PRE creates contextIds via computeContextId().
 * ACTION resolves frames via the registry built at action-entry time.
 * The registry is a closure-scoped Map — never exposed on any interface.
 */

import type { Frame, Page } from 'playwright-core';

import ScraperError from '../../../Base/ScraperError.js';

/** Main page context identifier constant. */
const MAIN_CONTEXT_ID = 'main';

/** Iframe context identifier prefix. */
const IFRAME_PREFIX = 'iframe:';

/**
 * Compute a stable opaque contextId for a Page or Frame.
 * Uses frame URL (stable across dynamic iframe additions).
 * Fallback to frame.name() for about:blank iframes.
 * @param context - The Page or Frame to identify.
 * @param page - The main page (for main-frame detection).
 * @returns Stable opaque contextId string.
 */
/**
 * Strip query params from a URL for stable identification.
 * Session tokens in URLs change between PRE and ACTION — strip them.
 * @param rawUrl - Full URL with potential query params.
 * @returns Origin + pathname only.
 */
function stableUrl(rawUrl: string): string {
  try {
    const parsed = new URL(rawUrl);
    return `${parsed.origin}${parsed.pathname}`;
  } catch {
    return rawUrl;
  }
}

/**
 * Identify the "main" context (the page itself or its mainFrame).
 * Centralised so the contextId computation stays inside its budget.
 * @param context - The Page or Frame to test.
 * @param page - The main page.
 * @returns True iff `context` resolves to the main context.
 */
function isMainContext(context: Page | Frame, page: Page): boolean {
  if (context === page) return true;
  if ('mainFrame' in page && context === page.mainFrame()) return true;
  return false;
}

/**
 * Compute a stable opaque contextId for a Page or Frame.
 * @param context - The Page or Frame to identify.
 * @param page - The main page (for main-frame detection).
 * @returns Stable opaque contextId string.
 */
function computeContextId(context: Page | Frame, page: Page): string {
  if (isMainContext(context, page)) return MAIN_CONTEXT_ID;
  const frame = context as Frame;
  const url = frame.url();
  const hasRealUrl = url !== 'about:blank' && url.length > 0;
  const stableIdMap: Record<string, string> = { true: stableUrl(url), false: frame.name() };
  const stableId = stableIdMap[String(hasRealUrl)];
  return `${IFRAME_PREFIX}${stableId}`;
}

/** Immutable frame registry — maps contextId → actual Frame. */
type FrameRegistryMap = ReadonlyMap<string, Page | Frame>;

/**
 * Check if a frame is the main frame — used to filter in registry build.
 * @param frame - Frame to check.
 * @param page - Main page.
 * @returns True if main frame (skip in registry).
 */
function isMainFrame(frame: Frame, page: Page): boolean {
  return frame === page.mainFrame();
}

/**
 * Build an immutable frame registry from the current page state.
 * Called IMMEDIATELY before action() — captures exact frame state.
 * @param page - The Playwright page.
 * @returns Immutable map of contextId → Frame.
 */
function buildFrameRegistry(page: Page): FrameRegistryMap {
  const registry = new Map<string, Page | Frame>();
  registry.set(MAIN_CONTEXT_ID, page);
  const childFrames = page.frames().filter((f): boolean => !isMainFrame(f, page));
  for (const frame of childFrames) {
    const id = computeContextId(frame, page);
    registry.set(id, frame);
  }
  return registry;
}

/**
 * Resolve a Frame from the registry by contextId.
 * @param registry - The frame registry.
 * @param contextId - The opaque contextId.
 * @returns The actual Page or Frame.
 */
function resolveFrame(registry: FrameRegistryMap, contextId: string): Page | Frame {
  const frame = registry.get(contextId);
  if (!frame) throw new ScraperError(`Unknown contextId: ${contextId}`);
  return frame;
}

export type { FrameRegistryMap };
export { buildFrameRegistry, computeContextId, MAIN_CONTEXT_ID, resolveFrame };
