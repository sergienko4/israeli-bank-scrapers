/**
 * Login-form fields. A field is an input with a non-empty `name` and no
 * `disabled`. Every field must be hidden — `type` `hidden` in any case; no
 * `type` reads as `text`. Each field's name must match `FORM_FIELD_NAME` and
 * its value, `''` when absent, must be text of at most 32768 chars. The set
 * must hold `minFields` to `maxFields` fields, no name twice, every `required`
 * name and no `forbidden` one.
 */

import type { IFormCapture } from '../../ConfigContracts/index.js';
import type { HtmlAttrs, HtmlAttrValue } from '../HtmlTags.attrs.js';

/** A form field's name: 1 to 100 ASCII letters, digits, `_` or `-`. */
const FORM_FIELD_NAME = /^[\w-]{1,100}$/u;

/** Longest field value, in chars. */
const MAX_VALUE_CHARS = 32_768;

/** A field: its name, and its value or `true` when written without one. */
type FormField = readonly [string, HtmlAttrValue];

/** A sound field: its name and its text value. */
type SoundField = readonly [string, string];

/** The `{ name: value }` record, or why the fields were refused. */
type FieldsRecord = Readonly<Record<string, string>> | 'field not hidden' | 'fields invalid';

/**
 * Whether an input is a field: it has a name and is not disabled.
 * @param input - The input's attributes.
 * @returns True for a named, enabled input.
 */
function isField(input: HtmlAttrs): boolean {
  const name = input.get('name');
  return typeof name === 'string' && name !== '' && !input.has('disabled');
}

/**
 * Whether a field is hidden.
 * @param input - The field's attributes.
 * @returns True for `type` `hidden` in any case.
 */
function isHidden(input: HtmlAttrs): boolean {
  const type = input.get('type');
  return typeof type === 'string' && type.toLowerCase() === 'hidden';
}

/**
 * A field's name and value.
 * @param input - The field's attributes.
 * @returns Its name, and its value, '' when absent.
 */
function fieldOf(input: HtmlAttrs): FormField {
  const nameAttr = input.get('name');
  const name = String(nameAttr);
  return [name, input.get('value') ?? ''];
}

/**
 * Whether a field's name and value are sound.
 * @param field - Name and value.
 * @returns True for a valid name and a text value within the cap.
 */
function isSoundField(field: FormField): field is SoundField {
  const [name, value] = field;
  if (!FORM_FIELD_NAME.test(name) || typeof value !== 'string') return false;
  return value.length <= MAX_VALUE_CHARS;
}

/**
 * Whether a form's field names pass the capture's checks.
 * @param capture - Form capture.
 * @param names - Field names, in page order.
 * @returns True for a count in range, no name twice, every required name and no forbidden one.
 */
function isSoundSet(capture: IFormCapture, names: readonly string[]): boolean {
  const count = names.length;
  if (count < capture.minFields || count > capture.maxFields) return false;
  if (new Set(names).size !== count) return false;
  const hasRequired = capture.required.every((name): boolean => names.includes(name));
  return hasRequired && !capture.forbidden.some((name): boolean => names.includes(name));
}

/**
 * Check hidden fields' names and values, then the set they make.
 * @param capture - Form capture.
 * @param fields - Hidden fields' names and values, in page order.
 * @returns The `{ name: value }` record, or 'fields invalid'.
 */
function soundRecordOf(capture: IFormCapture, fields: readonly FormField[]): FieldsRecord {
  const sound = fields.filter(isSoundField);
  const names = sound.map(([name]): string => name);
  if (sound.length !== fields.length || !isSoundSet(capture, names)) return 'fields invalid';
  return Object.fromEntries(sound);
}

/**
 * Read a form's fields off its inputs.
 * @param capture - Form capture.
 * @param inputs - The form's inputs, in page order.
 * @returns The `{ name: value }` record, or why the fields were refused.
 */
function formFieldsOf(capture: IFormCapture, inputs: readonly HtmlAttrs[]): FieldsRecord {
  const fields = inputs.filter(isField);
  if (!fields.every(isHidden)) return 'field not hidden';
  const read = fields.map(fieldOf);
  return soundRecordOf(capture, read);
}

export { FORM_FIELD_NAME, formFieldsOf };
