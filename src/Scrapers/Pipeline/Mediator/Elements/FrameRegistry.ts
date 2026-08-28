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

/** Separates a per-frame identity token from the content-derived base id. */
const TOKEN_SEP = '|';

/** Shape of a generated identity token — `f` followed by digits. */
const TOKEN_RE = /^f\d+$/;

/** Monotonic counter backing the per-frame identity tokens. */
let tokenSeq = 0;

/** Per-frame identity tokens; entries die with their Frame. */
const FRAME_TOKENS = new WeakMap<Frame, string>();

/**
 * Return a stable identity token for a live Frame object.
 *
 * <p>Keyed on the Frame instance, so the token never changes when a
 * sibling frame attaches or detaches — unlike anything derived from the
 * frame's position in, or the current population of, `page.frames()`.
 * @param frame - The frame to identify.
 * @returns A token unique to this Frame instance.
 */
function frameToken(frame: Frame): string {
  const existing = FRAME_TOKENS.get(frame);
  if (existing !== undefined) return existing;
  tokenSeq += 1;
  const minted = `f${String(tokenSeq)}`;
  FRAME_TOKENS.set(frame, minted);
  return minted;
}

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
 * Compute a stable opaque contextId for a Page or Frame.
 *
 * <p>Two halves, and each covers the other's blind spot. The identity
 * token pins the exact Frame instance, so two sibling iframes that share
 * an origin+pathname (session token stripped) or are both unnamed
 * `about:blank` no longer collapse onto one id. The content-derived base
 * survives a frame detaching and re-attaching as a new object, which is
 * the case identity alone cannot express.
 *
 * <p>A base a sibling already shares describes neither frame, so such a
 * frame is minted with its token alone. Content can then never be used to
 * resolve it, closing the one path by which a stale id could reach a
 * surviving sibling once the frame it named detached.
 * @param context - The Page or Frame to identify.
 * @param page - The main page (for main-frame detection).
 * @returns Stable opaque contextId string.
 */
function computeContextId(context: Page | Frame, page: Page): string {
  const baseId = baseContextId(context, page);
  if (baseId === MAIN_CONTEXT_ID) return baseId;
  const token = frameToken(context as Frame);
  const isShared = isSharedBase(page, baseId);
  if (isShared) return token;
  return `${token}${TOKEN_SEP}${baseId}`;
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
 * List every alias under which a frame must be resolvable.
 *
 * <p>The token is read from the frame itself rather than parsed back out
 * of its id: an id minted for an ambiguous frame is the bare token, so
 * parsing it for a token would yield nothing and register the frame under
 * the empty string.
 * @param frame - The frame to describe.
 * @param page - The main page.
 * @returns The frame's aliases, in registration order.
 */
function frameAliases(frame: Frame, page: Page): [string, string, string] {
  const exactId = computeContextId(frame, page);
  const baseId = baseContextId(frame, page);
  const token = frameToken(frame);
  return [baseId, token, exactId];
}

/**
 * Count how many child frames claim each content-derived base id.
 * @param frames - The page's child frames.
 * @param page - The main page.
 * @returns Base id → number of frames claiming it.
 */
function baseIdCounts(frames: Frame[], page: Page): Map<string, number> {
  const counts = new Map<string, number>();
  for (const frame of frames) {
    const baseId = baseContextId(frame, page);
    const seen = counts.get(baseId) ?? 0;
    counts.set(baseId, seen + 1);
  }
  return counts;
}

/**
 * Whether more than one live frame claims a content-derived base id.
 * @param page - The main page.
 * @param baseId - The content-derived base id to test.
 * @returns True when a sibling frame claims the same base.
 */
function isSharedBase(page: Page, baseId: string): boolean {
  const frames = childFramesOf(page);
  const counts = baseIdCounts(frames, page);
  const claimants = counts.get(baseId) ?? 0;
  return claimants > 1;
}

/**
 * Choose the content key a frame is allowed to claim.
 *
 * <p>A base id several frames share identifies none of them. Registering it
 * anyway would hand back whichever sibling was written last, so an ambiguous
 * frame claims its own exact id instead — a key it already owns. Content
 * resolution then finds nothing and {@link resolveFrame} throws, turning a
 * silent wrong-frame fill into a loud failure.
 * @param baseId - The frame's content-derived base id.
 * @param exactId - The frame's tokenised id.
 * @param isShared - Whether a sibling claims the same base id.
 * @returns The key to register this frame's content alias under.
 */
function contentKeyOf(baseId: string, exactId: string, isShared: boolean): string {
  return isShared ? exactId : baseId;
}

/**
 * Build an immutable frame registry from the current page state.
 * Called IMMEDIATELY before action() — captures exact frame state.
 *
 * <p>Every frame is registered under its tokenised id and its bare identity
 * token, and — only when no sibling shares it — its bare base id.
 * @param page - The Playwright page.
 * @returns Immutable map of contextId → Frame.
 */
function buildFrameRegistry(page: Page): FrameRegistryMap {
  const registry = new Map<string, Page | Frame>();
  registry.set(MAIN_CONTEXT_ID, page);
  const frames = childFramesOf(page);
  const counts = baseIdCounts(frames, page);
  for (const frame of frames) {
    const [baseId, token, exactId] = frameAliases(frame, page);
    const isShared = counts.get(baseId) !== 1;
    const contentKey = contentKeyOf(baseId, exactId, isShared);
    registry.set(contentKey, frame);
    registry.set(token, frame);
    registry.set(exactId, frame);
  }
  return registry;
}

/**
 * Extract the leading identity token from a contextId, if it carries one.
 *
 * <p>Only reports a token when the prefix looks like a generated one AND
 * the remainder is a real base id, so a frame whose own name contains the
 * separator is never mistaken for a tokenised id.
 * @param contextId - A possibly tokenised contextId.
 * @returns The token, or an empty string when the id carries none.
 */
function tokenOf(contextId: string): string {
  const cut = contextId.indexOf(TOKEN_SEP);
  if (cut < 0) return '';
  const token = contextId.slice(0, cut);
  const isToken = TOKEN_RE.test(token);
  const isBaseId = contextId.slice(cut + 1).startsWith(IFRAME_PREFIX);
  return isToken && isBaseId ? token : '';
}

/**
 * Strip a leading identity token, if the id carries one.
 * @param contextId - A possibly tokenised contextId.
 * @returns The bare base contextId.
 */
function stripToken(contextId: string): string {
  const token = tokenOf(contextId);
  if (token.length === 0) return contextId;
  return contextId.slice(token.length + TOKEN_SEP.length);
}

/**
 * Ask which contextId a stored id's frame carries right now.
 * @param page - The live page.
 * @param contextId - A stored contextId.
 * @returns The frame's current contextId, or '' when it no longer resolves.
 */
function liveContextId(page: Page, contextId: string): string {
  const registry = buildFrameRegistry(page);
  const found = lookupFrame(registry, contextId);
  if (!found) return '';
  return computeContextId(found, page);
}

/**
 * Whether two contextIds name the same live frame.
 *
 * <p>Comparing the strings cannot answer this. An identity token pins one
 * Frame object, so a frame that re-attached mid-phase carries two ids for
 * one logical frame; but ignoring the token instead collapses two live
 * siblings that share a base onto each other. Neither reading is safe:
 * the first makes the field-collision guard miss a duplicate and the
 * submit gate reject a button in the right frame, the second makes the
 * guard drop a real second field and the submit gate accept a button in
 * the wrong one.
 *
 * <p>Resolving both ids against the live page removes the ambiguity. Every
 * id for a frame that is still there collapses onto that frame's current
 * id, while two live siblings keep the distinct tokens they were minted
 * with. An id that no longer resolves cannot be proven equal to anything.
 * @param page - The live page both ids are read against.
 * @param a - First contextId.
 * @param b - Second contextId.
 * @returns True when both ids name one live frame.
 */
function isSameContext(page: Page, a: string, b: string): boolean {
  if (a === b) return true;
  const liveA = liveContextId(page, a);
  const liveB = liveContextId(page, b);
  const isResolved = liveA.length > 0 && liveB.length > 0;
  return isResolved && liveA === liveB;
}

/**
 * Choose the registry key that matches a frame on identity alone.
 * @param contextId - The opaque contextId.
 * @returns The bare identity token, or the id itself when it carries none —
 * which cannot match, since the bare id was already tried.
 */
function tokenKeyOf(contextId: string): string {
  const token = tokenOf(contextId);
  return token.length > 0 ? token : contextId;
}

/**
 * Look a contextId up through the three narrowing steps.
 * @param registry - The frame registry.
 * @param contextId - The opaque contextId.
 * @returns The Page or Frame, or false when nothing matches.
 */
function lookupFrame(registry: FrameRegistryMap, contextId: string): Page | Frame | false {
  const exact = registry.get(contextId);
  if (exact) return exact;
  const tokenKey = tokenKeyOf(contextId);
  const sameFrame = registry.get(tokenKey);
  if (sameFrame) return sameFrame;
  const baseId = stripToken(contextId);
  return registry.get(baseId) ?? false;
}

/**
 * Resolve a Frame from the registry by contextId.
 *
 * <p>Three narrowing attempts. The full id is an exact content+identity
 * match. The bare token still pins the same live Frame after it navigated
 * and its content-derived base changed. Only once identity is gone — the
 * frame detached and re-attached as a new object — does resolution fall
 * back to matching on content alone, and then only when exactly one frame
 * claims that content; an ambiguous base throws rather than guess.
 * @param registry - The frame registry.
 * @param contextId - The opaque contextId.
 * @returns The actual Page or Frame.
 */
function resolveFrame(registry: FrameRegistryMap, contextId: string): Page | Frame {
  const found = lookupFrame(registry, contextId);
  if (!found) throw new ScraperError(`Unknown contextId: ${contextId}`);
  return found;
}

export type { FrameRegistryMap };
export { buildFrameRegistry, computeContextId, isSameContext, MAIN_CONTEXT_ID, resolveFrame };
