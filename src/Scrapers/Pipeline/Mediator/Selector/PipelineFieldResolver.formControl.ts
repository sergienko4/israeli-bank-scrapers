/**
 * Form-control guard for resolved field targets.
 *
 * A `textContent` candidate resolves by finding visible text and walking up to the
 * nearest interactive ancestor. When the page is not the expected login form — a
 * maintenance screen, an interstitial, a redesigned layout — that ancestor can be an
 * anchor rather than the credential box. Yahav served exactly this during a
 * maintenance window: a "תעודת זהות" link that the walk-up returned as
 * `xpath=//a[.//text()[contains(., "תעודת זהות")]]`.
 *
 * Accepting a non-fillable element is silent: the later `.fill()` writes nothing,
 * the form stays client-side invalid, the submit click is a no-op, and the run ends
 * with zero WARN and zero ERROR. This guard turns that into an explicit
 * not-resolved outcome so the caller's remaining rounds and logging engage.
 *
 * The predicate is deliberately narrower than `isFillableInput`: it rejects only
 * elements that are not form controls at all. Dashboard date navigation resolves
 * `<input type="date">`, whose type is absent from `FILLABLE_INPUT_TYPES` but is a
 * legitimate fill target, so tag-level checking is the correct granularity here.
 */

import type { Frame, Page } from 'playwright-core';

import { getDebug } from '../../Logging/Debug.js';
import { extractElementMeta } from './SelectorLabelStrategies.elements.js';
import type { IFieldContext } from './SelectorResolverPipeline.js';

const LOG = getDebug(import.meta.url);

/** Tags that accept programmatic text entry through Locator.fill(). */
const FORM_CONTROL_TAGS = new Set(['input', 'textarea']);

/**
 * Permissive fallback used when the element cannot be inspected.
 * @returns Always true, so an uninspectable element is never rejected.
 */
const ALLOW = (): boolean => true;

/**
 * Report whether a resolved selector points at a form control.
 * @param ctx - Owning Page or Frame.
 * @param selector - Resolved selector, possibly an `xpath=` expression.
 * @returns True when the element is an input or textarea.
 */
async function isFormControl(ctx: Page | Frame, selector: string): Promise<boolean> {
  const meta = await extractElementMeta(ctx, selector);
  if (!meta) return false;
  return FORM_CONTROL_TAGS.has(meta.tag);
}

/**
 * Build the not-resolved outcome, preserving the probed context.
 * @param ctx - Context the rejected match came from.
 * @returns A not-resolved field context.
 */
function notResolved(ctx: Page | Frame): IFieldContext {
  return {
    isResolved: false,
    selector: '',
    context: ctx,
    resolvedVia: 'notResolved',
    round: 'notResolved',
  };
}

/**
 * Reject a resolved field whose element cannot accept text.
 * @param result - Probe outcome to vet.
 * @param fieldKey - Field being resolved, for diagnostics.
 * @returns The original result, or a not-resolved outcome when non-fillable.
 */
async function rejectNonFormControl(
  result: IFieldContext,
  fieldKey: string,
): Promise<IFieldContext> {
  if (!result.isResolved) return result;
  const isControl = await isFormControl(result.context, result.selector).catch(ALLOW);
  if (isControl) return result;
  LOG.warn({ event: 'login.field_not_form_control', field: fieldKey, selector: result.selector });
  return notResolved(result.context);
}

export default rejectNonFormControl;

export { rejectNonFormControl };
