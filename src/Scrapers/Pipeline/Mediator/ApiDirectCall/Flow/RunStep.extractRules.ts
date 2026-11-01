/**
 * Extract rules (N18, N27). A step's `extractRules` check its body-, header-
 * and text-capture slots on the raw value once the answer is read. `type` is
 * checked first. A string — or a finite number, stringified, when the rule
 * sets a text check — is then transformed and checked: `maxChars` (8192 when
 * unset), `oneOf`, the whole text against `pattern`, the `url` allow-list,
 * resolved against the step URL, and `pemCertificate`, whose key ref resolves
 * against the step's scope. A text-capture slot with no rule still gets the
 * 8192 `maxChars` check (N36). The slot keeps the checked text; the rest of
 * the carry passes through. An optional slot whose pointer is unresolved,
 * null or '' skips its rule. A refusal fails the step
 * `<step> extract <slot> invalid`, naming no value.
 */

import { ScraperErrorTypes } from '../../../../Base/ErrorTypes.js';
import { matchesAnyUrlRule } from '../../../Strategy/Fetch/UrlRule.js';
import type { IProcedureFailure, Procedure } from '../../../Types/Procedure.js';
import { fail, isOk, succeed } from '../../../Types/Procedure.js';
import type { ExtractValueType, IExtractRule, IStepConfig } from '../ConfigContracts/index.js';
import { walkPointer } from '../Envelope/JsonPointer.js';
import type { ITemplateScope } from '../Template/RefResolver.js';
import { isPemCertificate } from './RunStep.pemRule.js';
import { stepBaseUrlOf } from './RunStep.stepUrl.js';
import { captureSlotsOf } from './RunStep.textCapture.js';
import type { CarryMap, IDispatchBundle, JsonValue } from './RunStep.types.js';

const DEFAULT_MAX_CHARS = 8192;

/** One step's rule pass: the step, its body, its carry, its URL and its scope. */
interface IRulePass {
  readonly step: IStepConfig;
  readonly resp: JsonValue;
  readonly carry: CarryMap;
  readonly stepUrl: string;
  readonly scope: ITemplateScope;
}

/** One ruled slot: its carry name and its rule. */
type RuleEntry = readonly [string, IExtractRule];

/** A value kept for a slot; null is a value, so it is boxed. */
interface IKept {
  readonly kept: JsonValue;
}

/** Whether a raw value has a demanded JSON type. */
type TypeCheck = (value: JsonValue) => boolean;

/** One text check over the transformed text. */
type TextCheck = (text: string, rule: IExtractRule, input: IRulePass) => boolean;

/**
 * Whether a value is a string.
 * @param value - Raw value.
 * @returns True for a string.
 */
function isText(value: JsonValue): boolean {
  return typeof value === 'string';
}

/**
 * Whether a value is a finite number.
 * @param value - Raw value.
 * @returns True for a finite number.
 */
function isFiniteNumber(value: JsonValue): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

/**
 * Whether a value is a record.
 * @param value - Raw value.
 * @returns True for a non-null, non-array object.
 */
function isRecord(value: JsonValue): boolean {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Whether a value is a list.
 * @param value - Raw value.
 * @returns True for an array.
 */
function isList(value: JsonValue): boolean {
  return Array.isArray(value);
}

const TYPE_CHECKS: Readonly<Record<ExtractValueType, TypeCheck>> = {
  string: isText,
  number: isFiniteNumber,
  object: isRecord,
  array: isList,
};

/**
 * Whether the text fits the rule's length cap.
 * @param text - Transformed text.
 * @param rule - Extract rule.
 * @returns True within `maxChars`, 8192 when unset.
 */
function isWithinMax(text: string, rule: IExtractRule): boolean {
  return text.length <= (rule.maxChars ?? DEFAULT_MAX_CHARS);
}

/**
 * Whether the text is one of the allowed texts.
 * @param text - Transformed text.
 * @param rule - Extract rule.
 * @returns True when `oneOf` is unset or lists the text.
 */
function isOneOf(text: string, rule: IExtractRule): boolean {
  return rule.oneOf?.includes(text) ?? true;
}

/**
 * Whether the whole text matches the rule's pattern.
 * @param text - Transformed text.
 * @param rule - Extract rule.
 * @returns True when `pattern` is unset or matches the whole text.
 */
function isPatternMatch(text: string, rule: IExtractRule): boolean {
  if (rule.pattern === undefined) return true;
  const whole = new RegExp(`^(?:${rule.pattern})$`, 'u');
  return whole.test(text);
}

/**
 * Parse a URL text against the step URL.
 * @param text - URL text, absolute or relative.
 * @param stepUrl - The step URL.
 * @returns The URL, or false when it does not parse.
 */
function parsedUrl(text: string, stepUrl: string): URL | false {
  try {
    return new URL(text, stepUrl);
  } catch {
    return false;
  }
}

/**
 * Whether the text is a URL on the rule's allow-list.
 * @param text - Transformed text.
 * @param rule - Extract rule.
 * @param input - Rule pass input; a relative text resolves against its step URL.
 * @returns True when `url` is unset or a rule matches.
 */
function isAllowedUrl(text: string, rule: IExtractRule, input: IRulePass): boolean {
  if (rule.url === undefined) return true;
  const target = parsedUrl(text, input.stepUrl);
  return target !== false && matchesAnyUrlRule(target, rule.url);
}

const TEXT_CHECKS: readonly TextCheck[] = [
  isWithinMax,
  isOneOf,
  isPatternMatch,
  isAllowedUrl,
  isPemCertificate,
];

/**
 * Whether the rule sets a text check.
 * @param rule - Extract rule.
 * @returns True when a transform or any text check is set.
 */
function hasTextCheck(rule: IExtractRule): boolean {
  const { transform, oneOf, pattern, url, maxChars, pemCertificate } = rule;
  const checks = [transform, oneOf, pattern, url, maxChars, pemCertificate];
  return checks.some(check => check !== undefined);
}

/**
 * Whether a raw value has the rule's JSON type.
 * @param value - Raw value.
 * @param rule - Extract rule.
 * @returns True when `type` is unset or matches.
 */
function isTypeSound(value: JsonValue, rule: IExtractRule): boolean {
  if (rule.type === undefined) return true;
  const isType = TYPE_CHECKS[rule.type];
  return isType(value);
}

/**
 * Transform a text and run the text checks on it.
 * @param text - The string, or the number stringified.
 * @param rule - Extract rule.
 * @param input - Rule pass input.
 * @returns The transformed text, or false when a check refuses it.
 */
function checkText(text: string, rule: IExtractRule, input: IRulePass): IKept | false {
  const shaped = rule.transform === 'lower' ? text.toLowerCase() : text;
  const isSound = TEXT_CHECKS.every(check => check(shaped, rule, input));
  return isSound && { kept: shaped };
}

/**
 * Check one raw value against its rule.
 * @param value - Raw value.
 * @param rule - Extract rule.
 * @param input - Rule pass input.
 * @returns The value the slot keeps, or false when refused.
 */
function checkValue(value: JsonValue, rule: IExtractRule, input: IRulePass): IKept | false {
  if (!isTypeSound(value, rule)) return false;
  if (typeof value === 'string') return checkText(value, rule, input);
  if (!hasTextCheck(rule)) return { kept: value };
  if (!isFiniteNumber(value)) return false;
  const text = String(value);
  return checkText(text, rule, input);
}

/**
 * Whether a slot is always in the step's carry: a required body extract, a
 * header extract, which holds the header or its fallback, or a text capture.
 * @param step - Step config.
 * @param slot - Carry slot name.
 * @returns True for a required body slot, a header slot or a capture slot.
 */
function isCarriedSlot(step: IStepConfig, slot: string): boolean {
  const headers = step.headerExtractsToCarry ?? {};
  if (Object.hasOwn(step.extractsToCarry, slot) || Object.hasOwn(headers, slot)) return true;
  return captureSlotsOf(step).includes(slot);
}

/**
 * Read a ruled slot: a required or header slot from the carry, an optional
 * one at its pointer.
 * @param input - Rule pass input.
 * @param slot - Carry slot name.
 * @returns The raw value, or false when an optional slot is absent, null or ''.
 */
function slotValue(input: IRulePass, slot: string): IKept | false {
  if (isCarriedSlot(input.step, slot)) return { kept: input.carry[slot] };
  const optional = input.step.optionalExtractsToCarry?.[slot];
  if (optional === undefined) return false;
  const walked = walkPointer(input.resp, optional.pointer);
  if (!isOk(walked) || walked.value === null || walked.value === '') return false;
  return { kept: walked.value };
}

/**
 * Check one ruled slot.
 * @param input - Rule pass input.
 * @param entry - The slot and its rule.
 * @returns The slot's checked value, {} when skipped, or the refusal.
 */
function checkSlot(input: IRulePass, entry: RuleEntry): Procedure<CarryMap> {
  const [slot, rule] = entry;
  const read = slotValue(input, slot);
  if (read === false) return succeed({});
  const checked = checkValue(read.kept, rule, input);
  if (checked !== false) return succeed({ [slot]: checked.kept });
  return fail(ScraperErrorTypes.Generic, `${input.step.name} extract ${slot} invalid`);
}

/**
 * Whether a slot verdict is a refusal.
 * @param verdict - One slot's verdict.
 * @returns True when the slot was refused.
 */
function isRefused(verdict: Procedure<CarryMap>): verdict is IProcedureFailure {
  return !isOk(verdict);
}

/**
 * A step's ruled slots: its `extractRules`, then each text-capture slot with
 * no rule of its own under the empty rule, which caps it at 8192 chars.
 * @param step - Step config.
 * @returns Slot and rule pairs, in config order.
 */
function ruleEntriesOf(step: IStepConfig): readonly RuleEntry[] {
  const rules = step.extractRules ?? {};
  const unruled = captureSlotsOf(step).filter((slot): boolean => !Object.hasOwn(rules, slot));
  const defaults = unruled.map((slot): RuleEntry => [slot, {}]);
  return [...Object.entries(rules), ...defaults];
}

/**
 * Check a step's ruled slots.
 * @param input - The step, its body, its carry, its URL and its scope.
 * @returns The carry with each ruled slot checked, or the first refusal.
 */
function applyExtractRules(input: IRulePass): Procedure<CarryMap> {
  const entries = ruleEntriesOf(input.step);
  const verdicts = entries.map(entry => checkSlot(input, entry));
  const refused = verdicts.find(isRefused);
  if (refused) return refused;
  const slots = verdicts.filter(isOk).map(verdict => verdict.value);
  const ruled = slots.reduce<CarryMap>((carry, slot) => ({ ...carry, ...slot }), input.carry);
  return succeed(ruled);
}

/**
 * Check the ruled slots of a dispatched step; a relative URL resolves against
 * the step's base URL — its carried URL or its WK url — and a key ref against
 * the step's prepared scope, which holds the carry of earlier steps and of
 * this step's generators.
 * @param bundle - Dispatch bundle.
 * @param resp - Successful response JSON.
 * @param carry - The step's carry, read from the answer.
 * @returns The carry with each ruled slot checked, or the refusal.
 */
function ruleStepCarry(
  bundle: IDispatchBundle,
  resp: JsonValue,
  carry: CarryMap,
): Procedure<CarryMap> {
  const { fireScope, preparedScope: scope } = bundle;
  const urlProc = stepBaseUrlOf(fireScope);
  if (!isOk(urlProc)) return urlProc;
  return applyExtractRules({ step: fireScope.step, resp, carry, stepUrl: urlProc.value, scope });
}

export { applyExtractRules, ruleStepCarry };
