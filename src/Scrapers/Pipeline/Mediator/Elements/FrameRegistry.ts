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

/** Separates a base contextId from its positional disambiguator. */
const ORDINAL_SEP = '#';

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
 * Compute the content-derived contextId, ignoring any sibling collision.
 * @param context - The Page or Frame to identify.
 * @param page - The main page (for main-frame detection).
 * @returns Base contextId, not yet disambiguated.
 */
function baseContextId(context: Page | Frame, page: Page): string {
  if (isMainContext(context, page)) return MAIN_CONTEXT_ID;
  const frame = context as Frame;
  const url = frame.url();
  const hasRealUrl = url !== 'about:blank' && url.length > 0;
  const stableIdMap: Record<string, string> = { true: stableUrl(url), false: frame.name() };
  const stableId = stableIdMap[String(hasRealUrl)];
  return `${IFRAME_PREFIX}${stableId}`;
}

/**
 * List the child frames sharing a base contextId, in Playwright's frame order.
 * @param baseId - The base contextId to match.
 * @param page - The main page.
 * @returns Every child frame whose base contextId equals `baseId`.
 */
function siblingsOf(baseId: string, page: Page): Frame[] {
  const children = childFramesOf(page);
  return children.filter((f): boolean => baseContextId(f, page) === baseId);
}

/**
 * Compute a stable opaque contextId for a Page or Frame.
 *
 * <p>The base id is content-derived so it survives a frame navigating
 * between PRE and ACTION. Content alone is NOT unique: two sibling
 * iframes can share an origin+pathname (session token stripped) or both
 * be unnamed `about:blank`. When that happens the id gains a positional
 * suffix so PRE and ACTION address the same frame instead of silently
 * collapsing onto whichever one the registry wrote last.
 * @param context - The Page or Frame to identify.
 * @param page - The main page (for main-frame detection).
 * @returns Stable opaque contextId string.
 */
function computeContextId(context: Page | Frame, page: Page): string {
  const baseId = baseContextId(context, page);
  if (baseId === MAIN_CONTEXT_ID) return baseId;
  const siblings = siblingsOf(baseId, page);
  if (siblings.length < 2) return baseId;
  const ordinal = siblings.indexOf(context as Frame);
  if (ordinal < 0) return baseId;
  const suffix = String(ordinal);
  return `${baseId}${ORDINAL_SEP}${suffix}`;
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
 * List every frame on the page except the main frame.
 * @param page - The main page.
 * @returns Child frames in Playwright's frame order.
 */
function childFramesOf(page: Page): Frame[] {
  return page.frames().filter((f): boolean => !isMainFrame(f, page));
}

/**
 * Build an immutable frame registry from the current page state.
 * Called IMMEDIATELY before action() — captures exact frame state.
 *
 * <p>Colliding frames are registered under BOTH their disambiguated id
 * and their bare base id. The bare alias keeps the pre-existing
 * last-write-wins resolution reachable for a contextId minted when the
 * frame set looked different, so this fix can only ever add a correct
 * mapping — it never removes one that used to resolve.
 * @param page - The Playwright page.
 * @returns Immutable map of contextId → Frame.
 */
function buildFrameRegistry(page: Page): FrameRegistryMap {
  const registry = new Map<string, Page | Frame>();
  registry.set(MAIN_CONTEXT_ID, page);
  for (const frame of childFramesOf(page)) {
    const baseId = baseContextId(frame, page);
    const exactId = computeContextId(frame, page);
    registry.set(baseId, frame);
    registry.set(exactId, frame);
  }
  return registry;
}

/**
 * Resolve a Frame from the registry by contextId.
 *
 * <p>Falls back to the bare base id when a disambiguated id misses,
 * which happens if a colliding sibling detached between PRE and ACTION.
 * @param registry - The frame registry.
 * @param contextId - The opaque contextId.
 * @returns The actual Page or Frame.
 */
function resolveFrame(registry: FrameRegistryMap, contextId: string): Page | Frame {
  const frame = registry.get(contextId);
  if (frame) return frame;
  const [baseId] = contextId.split(ORDINAL_SEP);
  const fallback = registry.get(baseId);
  if (!fallback) throw new ScraperError(`Unknown contextId: ${contextId}`);
  return fallback;
}

export type { FrameRegistryMap };
export { buildFrameRegistry, computeContextId, MAIN_CONTEXT_ID, resolveFrame };
