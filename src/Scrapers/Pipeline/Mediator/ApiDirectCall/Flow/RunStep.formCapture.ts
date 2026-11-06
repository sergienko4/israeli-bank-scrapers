/**
 * Login-form capture. A `text` step's `formCapture` finds the page's one
 * `<form>` whose `id` or `name` is `form`: none fails `<step> form <form>
 * missing`, two `<step> form <form> ambiguous`. The form must post — `method`
 * `post` in any case — to `action`, its own action resolved against the URL
 * that answered; else `<step> form action refused`. Its inputs run to its end
 * tag or the next form, and `formFieldsOf` checks them (`<step> form field not
 * hidden`, `<step> form fields invalid`). The `{ name: value }` record goes to
 * carry `into`. No failure names a field or a value.
 */

import { ScraperErrorTypes } from '../../../../Base/ErrorTypes.js';
import type { IProcedureFailure, Procedure } from '../../../Types/Procedure.js';
import { fail, isOk, succeed } from '../../../Types/Procedure.js';
import type { IFormCapture, IStepConfig } from '../ConfigContracts/index.js';
import type { HtmlAttrs } from './HtmlTags.attrs.js';
import { type IHtmlTag, scanHtmlTags } from './HtmlTags.js';
import { formFieldsOf } from './RunStep.formFields.js';
import { answerText } from './RunStep.textCapture.js';
import type { CarryMap, IRunStepArgs, JsonValue } from './RunStep.types.js';

/** A page's tags, and for each the index of the form it sits in, or -1. */
interface IPageForms {
  readonly tags: readonly IHtmlTag[];
  readonly owners: readonly number[];
}

/** The step, its capture and its URL. */
interface IFormTarget {
  readonly step: IStepConfig;
  readonly capture: IFormCapture;
  readonly stepUrl: string;
}

/**
 * Fail the capture, naming the step only.
 * @param step - Step config.
 * @param reason - Why it failed.
 * @returns Generic failure.
 */
function refuse(step: IStepConfig, reason: string): IProcedureFailure {
  return fail(ScraperErrorTypes.Generic, `${step.name} form ${reason}`);
}

/**
 * The form a tag sits in, given the one the tag before it sat in.
 * @param tag - Page tag.
 * @param index - Its index.
 * @param open - The open form's index, or -1.
 * @returns The form open after the tag: a form start opens, a form end closes.
 */
function ownerAt(tag: IHtmlTag, index: number, open: number): number {
  if (tag.name !== 'form') return open;
  return tag.kind === 'start' ? index : -1;
}

/**
 * Read a page's tags and the form each sits in.
 * @param html - Page text.
 * @returns Tags and their forms.
 */
function pageFormsOf(html: string): IPageForms {
  const tags = scanHtmlTags(html);
  const owners: number[] = [];
  for (let index = 0, open = -1; index < tags.length; index += 1) {
    open = ownerAt(tags[index], index, open);
    owners.push(open);
  }
  return { tags, owners };
}

/**
 * Whether a tag starts the form the capture names.
 * @param tag - Page tag.
 * @param form - The form's `id` or `name`.
 * @returns True for a form start whose `id` or `name` is `form`.
 */
function startsForm(tag: IHtmlTag, form: string): boolean {
  if (tag.kind !== 'start' || tag.name !== 'form') return false;
  return tag.attrs.get('id') === form || tag.attrs.get('name') === form;
}

/**
 * Whether a form posts to the capture's action.
 * @param form - The form's attributes.
 * @param target - The capture and the step URL.
 * @returns True for `method` post and an action that resolves to `action`.
 */
function postsTo(form: HtmlAttrs, target: IFormTarget): boolean {
  const method = form.get('method');
  const action = form.get('action');
  if (typeof method !== 'string' || method.toLowerCase() !== 'post') return false;
  if (typeof action !== 'string' || !URL.canParse(action, target.stepUrl)) return false;
  return new URL(action, target.stepUrl).href === target.capture.action;
}

/**
 * The inputs of one form.
 * @param page - Tags and their forms.
 * @param form - The form's index.
 * @returns Its inputs' attributes, in page order.
 */
function inputsOf(page: IPageForms, form: number): readonly HtmlAttrs[] {
  const inForm = page.tags.filter((_, index): boolean => page.owners[index] === form);
  const inputs = inForm.filter((tag): boolean => tag.kind === 'start' && tag.name === 'input');
  return inputs.map((tag): HtmlAttrs => tag.attrs);
}

/**
 * Find the one form the capture names.
 * @param page - Tags and their forms.
 * @param form - The form's `id` or `name`.
 * @returns The form tag's index, or why none was found.
 */
function namedFormOf(page: IPageForms, form: string): number | 'missing' | 'ambiguous' {
  const indexes = page.tags.map((tag, index): number => (startsForm(tag, form) ? index : -1));
  const starts = indexes.filter((index): boolean => index >= 0);
  if (starts.length > 1) return 'ambiguous';
  return starts.at(0) ?? 'missing';
}

/**
 * Find the named form on a page and check where it posts.
 * @param target - The step, its capture and its URL.
 * @param html - Page text.
 * @returns The form's inputs, or the refusal.
 */
function formInputsOf(target: IFormTarget, html: string): Procedure<readonly HtmlAttrs[]> {
  const { step, capture } = target;
  const page = pageFormsOf(html);
  const form = namedFormOf(page, capture.form);
  if (typeof form === 'string') return refuse(step, `${capture.form} ${form}`);
  if (!postsTo(page.tags[form].attrs, target)) return refuse(step, 'action refused');
  const inputs = inputsOf(page, form);
  return succeed(inputs);
}

/**
 * Capture the named form off a page.
 * @param target - The step, its capture and its URL.
 * @param html - Page text.
 * @returns The `into` slot, or the refusal.
 */
function captureFormOf(target: IFormTarget, html: string): Procedure<CarryMap> {
  const inputs = formInputsOf(target, html);
  if (!isOk(inputs)) return inputs;
  const fields = formFieldsOf(target.capture, inputs.value);
  if (typeof fields === 'string') return refuse(target.step, fields);
  return succeed({ [target.capture.into]: fields });
}

/**
 * Capture a step's login form from its `{ text }` answer.
 * @param args - The step and its company.
 * @param resp - The step's answer.
 * @param answerUrl - Validated URL that answered the step.
 * @returns The `into` slot, {} without a capture, or the refusal.
 */
function captureForm(args: IRunStepArgs, resp: JsonValue, answerUrl: string): Procedure<CarryMap> {
  const { step } = args;
  if (step.formCapture === undefined) return succeed({});
  const target: IFormTarget = { step, capture: step.formCapture, stepUrl: answerUrl };
  const html = answerText(resp);
  return captureFormOf(target, html);
}

export default captureForm;
export { captureForm };
