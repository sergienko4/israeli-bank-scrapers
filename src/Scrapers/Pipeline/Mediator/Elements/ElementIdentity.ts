/**
 * ElementIdentity — a token that says *which element*, not *how it was found*.
 *
 * <p>Selector strings are a poor proxy for identity in both directions. Two
 * different inputs can answer the same string (a password field and its
 * confirmation both answer a type-based selector), and one input can be
 * described by two strings (`#user` and a placeholder match reaching the same
 * node). Comparing the strings therefore produces both false matches and false
 * misses, and the credential-collision guard that depends on that comparison
 * inherits both.
 *
 * <p>The token here is the element's position in the document tree, which is
 * unique per element and independent of the selector that found it.
 */

import type { Frame, Page } from 'playwright-core';

/** Budget for the identity read — a locator resolve plus one DOM walk. */
const IDENTITY_TIMEOUT_MS = 5_000;

/** Token returned when identity could not be established. */
const UNKNOWN_IDENTITY = '';

/** Result of walking up a single tree: where it stopped, and the path below. */
interface IWalkResult {
  readonly root: Node;
  readonly top: Element;
  readonly parts: string[];
}

/**
 * Build a position token for an element, inside the page.
 *
 * <p>Walks up to the document element recording each step's tag and index
 * among its siblings, so the token is the element's full path from the root
 * downward. The root itself contributes no segment — it is the same for every
 * element — so a detached element yields {@link UNKNOWN_IDENTITY}. Two
 * elements can never share a path; one element always keeps its own.
 *
 * <p>A shadow boundary stops `parentElement`, so a walk that ignored it would
 * end at the shadow root and describe an element by its position *within its
 * own shadow tree*. Two components of the same kind — two copies of one custom
 * element, each holding an input — would then answer the same path and be read
 * as one element. The walk therefore crosses the boundary through the host, so
 * the host's own path prefixes the inner one.
 *
 * <p>Self-contained by necessity: this runs in the browser realm, which is
 * also why the walk is nested and the boundary hop recurses — only this
 * function's own source is sent to the page.
 * @param el - The element to describe.
 * @returns Slash-separated path from the root, empty when detached.
 */
function elementPathToken(el: Element): string {
  /**
   * Walk up one tree, collecting a segment per step.
   * @param start - Element to walk from.
   * @returns The tree root, the element the walk stopped at, and the segments.
   */
  function walkUp(start: Element): IWalkResult {
    const parts: string[] = [];
    let node = start;
    let parent = node.parentElement;
    while (parent !== null) {
      const siblings = Array.from(parent.children);
      const index = siblings.indexOf(node);
      parts.unshift(`${node.tagName}:${String(index)}`);
      node = parent;
      parent = node.parentElement;
    }
    return { root: node.getRootNode(), top: node, parts };
  }
  const { root, top, parts } = walkUp(el);
  if (!(root instanceof ShadowRoot)) return parts.join('/');
  const index = [...root.children].indexOf(top);
  parts.unshift(`${top.tagName}:${String(index)}`);
  return `${elementPathToken(root.host)}/#shadow/${parts.join('/')}`;
}

/**
 * Read the identity token for the first element a selector resolves to.
 *
 * <p>Best-effort: a selector that no longer resolves, a detached element or a
 * frame that navigated mid-read all yield {@link UNKNOWN_IDENTITY}, which
 * callers treat as "identity unknown" rather than as a distinct identity.
 * @param context - The page or frame the selector belongs to.
 * @param selector - Selector already resolved by the field resolver.
 * @returns Position token, or {@link UNKNOWN_IDENTITY} when it cannot be read.
 */
async function readElementIdentity(context: Page | Frame, selector: string): Promise<string> {
  try {
    const matches = context.locator(selector);
    const locator = matches.first();
    const token = await locator.evaluate(elementPathToken, undefined, {
      timeout: IDENTITY_TIMEOUT_MS,
    });
    return token;
  } catch {
    return UNKNOWN_IDENTITY;
  }
}

export { elementPathToken, readElementIdentity, UNKNOWN_IDENTITY };
