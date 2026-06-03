/**
 * Element classification: fillable inputs vs. clickable interactive elements.
 * Owns the per-tag sets and the meta extraction helper.
 */

import type { Frame, Locator, Page } from 'playwright-core';

import type { IElementMeta } from './SelectorLabelStrategies.types.js';

/** Input types that accept text via Playwright .fill(). */
const FILLABLE_INPUT_TYPES = new Set([
  'text',
  'password',
  'email',
  'tel',
  'number',
  'search',
  'url',
  '',
]);

/** Tags that are inherently clickable interactive elements. */
const CLICKABLE_TAGS = new Set(['button', 'a', 'select']);

/** Input types that are click targets, not fill targets. */
const CLICKABLE_INPUT_TYPES = new Set(['submit', 'button', 'radio', 'checkbox']);

/** ARIA roles that indicate a clickable interactive element. */
const CLICKABLE_ROLES = new Set(['button', 'link', 'tab', 'menuitem']);

/**
 * Read a single HTML attribute as a string, normalising null → ''.
 * @param loc - The locator to read from.
 * @param name - Attribute name.
 * @returns Attribute value or empty string.
 */
async function readAttr(loc: Locator, name: string): Promise<string> {
  const value = await loc.getAttribute(name);
  if (value === null) return '';
  return value;
}

/**
 * Read the trio of attributes (type/role/tabindex) used for classification.
 * @param loc - The locator to read from.
 * @returns Tuple of attribute values.
 */
async function readClassifierAttrs(loc: Locator): Promise<[string, string, string]> {
  const type = await readAttr(loc, 'type');
  const role = await readAttr(loc, 'role');
  const tabindex = await readAttr(loc, 'tabindex');
  return [type, role, tabindex];
}

/**
 * Extract metadata from a DOM element for classification.
 * @param ctx - Playwright Page or Frame.
 * @param selector - CSS or XPath selector.
 * @returns Element metadata or false if not found.
 */
async function extractElementMeta(
  ctx: Page | Frame,
  selector: string,
): Promise<IElementMeta | false> {
  const loc = ctx.locator(selector).first();
  if ((await loc.count()) === 0) return false;
  const tag = await loc.evaluate((el: Element): string => el.tagName.toLowerCase());
  const [type, role, tabindex] = await readClassifierAttrs(loc);
  return { tag, type, role, tabindex };
}

/**
 * Check whether a resolved element is a fillable input (text, password, etc.).
 * @param ctx - The Playwright Page or Frame containing the element.
 * @param selector - CSS or XPath selector for the element to check.
 * @returns True if the element accepts text input via .fill().
 */
async function isFillableInput(ctx: Page | Frame, selector: string): Promise<boolean> {
  const meta = await extractElementMeta(ctx, selector);
  if (!meta) return false;
  if (meta.tag === 'textarea') return true;
  if (meta.tag === 'input') return FILLABLE_INPUT_TYPES.has(meta.type);
  return false;
}

/**
 * Check whether a resolved element is a clickable interactive element.
 * @param ctx - The Playwright Page or Frame containing the element.
 * @param selector - CSS or XPath selector for the element to check.
 * @returns True if the element is clickable (button, link, tab, etc.).
 */
async function isClickableElement(ctx: Page | Frame, selector: string): Promise<boolean> {
  const meta = await extractElementMeta(ctx, selector);
  if (!meta) return false;
  if (CLICKABLE_TAGS.has(meta.tag)) return true;
  if (meta.tag === 'input') return CLICKABLE_INPUT_TYPES.has(meta.type);
  if (CLICKABLE_ROLES.has(meta.role)) return true;
  return meta.tabindex !== '';
}

export {
  CLICKABLE_INPUT_TYPES,
  CLICKABLE_ROLES,
  CLICKABLE_TAGS,
  extractElementMeta,
  FILLABLE_INPUT_TYPES,
  isClickableElement,
  isFillableInput,
};
