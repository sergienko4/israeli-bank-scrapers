/**
 * DOM metadata extraction for the pipeline Mediator.
 * After finding an element by visible text, the Mediator extracts structural
 * metadata (id, class, type, form, etc.) for diagnostics and dynamic selector building.
 * Banks NEVER see HTML — the Mediator is the black box.
 */

import type { Frame, Page } from 'playwright-core';

/** HTML id attribute value (empty string if absent). */
type DomId = string;
/** CSS class string (space-separated). */
type DomClassName = string;
/** Lowercase HTML tag name (e.g. 'input', 'button'). */
type DomTagName = string;
/** Input type attribute (e.g. 'text', 'password', 'submit'). */
type DomInputType = string;
/** name attribute of the element. */
type DomName = string;
/** ID of the closest ancestor form element. */
type DomFormId = string;
/** aria-label attribute value. */
type DomAriaLabel = string;
/** placeholder attribute value. */
type DomPlaceholder = string;
/** Whether the element is currently visible in the viewport. */
type IsElementVisible = boolean;

/** Full DOM snapshot of a resolved element — extracted dynamically after text match. */
export interface IElementMetadata {
  /** HTML id attribute (empty string if absent). */
  readonly id: DomId;
  /** CSS class string (space-separated, empty if absent). */
  readonly className: DomClassName;
  /** Lowercase tag name (e.g. 'input', 'button'). */
  readonly tagName: DomTagName;
  /** Input type attribute (e.g. 'password', 'text', 'submit'). */
  readonly type: DomInputType;
  /** Name attribute of the element. */
  readonly name: DomName;
  /** Id of the closest ancestor form element (empty if no form). */
  readonly formId: DomFormId;
  /** aria-label attribute value. */
  readonly ariaLabel: DomAriaLabel;
  /** placeholder attribute value. */
  readonly placeholder: DomPlaceholder;
  /** Whether the element is currently visible in the viewport. */
  readonly isVisible: IsElementVisible;
}

/** Raw DOM properties extracted via page.evaluate. */
interface IRawDomProps {
  id: DomId;
  className: DomClassName;
  tagName: DomTagName;
  type: DomInputType;
  name: DomName;
  formId: DomFormId;
  ariaLabel: DomAriaLabel;
  placeholder: DomPlaceholder;
}

/** Empty DOM props used as fallback when element is not found. */
const EMPTY_DOM_PROPS: IRawDomProps = {
  id: '',
  className: '',
  tagName: '',
  type: '',
  name: '',
  formId: '',
  ariaLabel: '',
  placeholder: '',
};

/** Empty metadata — returned when element cannot be found or queried. */
export const EMPTY_METADATA: IElementMetadata = { ...EMPTY_DOM_PROPS, isVisible: false };

/**
 * Extract raw DOM properties from a resolved element via locator.evaluate.
 * Uses Playwright locator (not querySelector) — works for any selector type including xpath.
 * @param ctx - Page or Frame containing the element.
 * @param selector - Any Playwright selector (CSS, xpath, text, etc.).
 * @returns Raw DOM properties object, or empty props if element not found.
 */
async function extractDomProps(ctx: Page | Frame, selector: string): Promise<IRawDomProps> {
  const locator = ctx.locator(selector).first();
  /**
   * Catch visibility check failure.
   * @returns False.
   */
  const catchFalse = (): IsElementVisible => false;
  const isAttached = await locator.isVisible().catch(catchFalse);
  if (!isAttached) return EMPTY_DOM_PROPS;
  return locator.evaluate((el: Element): IRawDomProps => {
    const input = el as HTMLInputElement;
    const props: IRawDomProps = {
      id: el.id,
      className: el.className,
      tagName: el.tagName.toLowerCase(),
      type: input.type,
      name: input.name,
      formId: el.closest('form')?.id ?? '',
      ariaLabel: el.getAttribute('aria-label') ?? '',
      placeholder: input.placeholder,
    };
    return props;
  });
}

/**
 * Extract full metadata from a resolved DOM element.
 * Called by the Mediator after a text-based resolution succeeds.
 * @param ctx - Page or Frame containing the element.
 * @param selector - CSS selector of the resolved element.
 * @returns IElementMetadata with all available DOM properties.
 */
export async function extractMetadata(
  ctx: Page | Frame,
  selector: string,
): Promise<IElementMetadata> {
  const raw = await extractDomProps(ctx, selector);
  const locator = ctx.locator(selector).first();
  /**
   * Catch visibility check failure.
   * @returns False.
   */
  const catchFalse = (): IsElementVisible => false;
  const isVisible = await locator.isVisible().catch(catchFalse);
  const result: IElementMetadata = { ...raw, isVisible };
  return result;
}
