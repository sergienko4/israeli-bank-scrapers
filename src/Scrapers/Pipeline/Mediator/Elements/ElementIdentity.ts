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

/**
 * Build a position token for an element, inside the page.
 *
 * <p>Walks up to the document element recording each step's tag and index
 * among its siblings, so the token is the element's full path from the root
 * downward. The root itself contributes no segment — it is the same for every
 * element — so a detached element yields {@link UNKNOWN_IDENTITY}. Two
 * elements can never share a path; one element always keeps its own.
 *
 * <p>Self-contained by necessity: this runs in the browser realm.
 * @param el - The element to describe.
 * @returns Slash-separated path from the root, empty when detached.
 */
function elementPathToken(el: Element): string {
  const parts: string[] = [];
  let node = el;
  let parent = node.parentElement;
  while (parent !== null) {
    const siblings = Array.from(parent.children);
    const index = siblings.indexOf(node);
    parts.unshift(`${node.tagName}:${String(index)}`);
    node = parent;
    parent = node.parentElement;
  }
  return parts.join('/');
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
