/**
 * DOM metadata extraction for the pipeline Mediator.
 * After finding an element by visible text, the Mediator extracts structural
 * metadata (id, class, type, form, etc.) for diagnostics and dynamic selector building.
 * Banks NEVER see HTML — the Mediator is the black box.
 */

import type { Frame, Page } from 'playwright-core';

/** Full DOM snapshot of a resolved element — extracted dynamically after text match. */
export interface IElementMetadata {
  /** HTML id attribute (empty string if absent). */
  readonly id: string;
  /** CSS class string (space-separated, empty if absent). */
  readonly className: string;
  /** Lowercase tag name (e.g. 'input', 'button'). */
  readonly tagName: string;
  /** Input type attribute (e.g. 'password', 'text', 'submit'). */
  readonly type: string;
  /** Name attribute of the element. */
  readonly name: string;
  /** Id of the closest ancestor form element (empty if no form). */
  readonly formId: string;
  /** aria-label attribute value. */
  readonly ariaLabel: string;
  /** placeholder attribute value. */
  readonly placeholder: string;
  /** Whether the element is currently visible in the viewport. */
  readonly isVisible: boolean;
}

/** Raw DOM properties extracted via page.evaluate. */
interface IRawDomProps {
  id: string;
  className: string;
  tagName: string;
  type: string;
  name: string;
  formId: string;
  ariaLabel: string;
  placeholder: string;
}

/** Evaluate argument combining the selector and fallback empty props. */
interface IEvalArg {
  sel: string;
  empty: IRawDomProps;
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
 * Extract raw DOM properties from an element via page.evaluate.
 * Passes an empty fallback to avoid returning null from the browser-side callback.
 * @param ctx - Page or Frame containing the element.
 * @param selector - CSS selector identifying the element.
 * @returns Raw DOM properties object.
 */
async function extractDomProps(ctx: Page | Frame, selector: string): Promise<IRawDomProps> {
  return ctx.evaluate(
    ({ sel, empty }: IEvalArg): IRawDomProps => {
      const el = document.querySelector(sel);
      if (!el) return empty;
      const input = el as HTMLInputElement;
      return {
        id: el.id,
        className: el.className,
        tagName: el.tagName.toLowerCase(),
        type: input.type,
        name: input.name,
        formId: el.closest('form')?.id ?? '',
        ariaLabel: el.getAttribute('aria-label') ?? '',
        placeholder: input.placeholder,
      };
    },
    { sel: selector, empty: EMPTY_DOM_PROPS },
  );
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
  const isVisible = await locator.isVisible().catch(() => false);
  return { ...raw, isVisible };
}
