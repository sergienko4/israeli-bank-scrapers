/**
 * Step URL — the URL a step sends to: the absolute URL in its `urlFromCarry`
 * slot or else its WK url, with its raw query after `?` verbatim.
 * The fire hands the bus such a step's URL as a literal and any other step's
 * WK tag, as before.
 */

import { ScraperErrorTypes } from '../../../../Base/ErrorTypes.js';
import { literalUrl, resolveWkUrl, type WKUrlOrLiteral } from '../../../Registry/WK/UrlsWK.js';
import { matchesAnyUrlRule } from '../../../Strategy/Fetch/UrlRule.js';
import type { Procedure } from '../../../Types/Procedure.js';
import { fail, isOk, succeed } from '../../../Types/Procedure.js';
import type { IJoinTemplate } from '../ConfigContracts/index.js';
import { hydrateJoin } from '../Template/JoinTemplate.js';
import type { IRunStepArgs, JsonValue } from './RunStep.types.js';

/** What resolves a step's URL: the step, its scope and its company. */
type IStepUrlInput = Pick<IRunStepArgs, 'step' | 'scope' | 'companyId' | 'carriedUrlRules'>;

/** One to 32 768 printable-ASCII chars. */
const RAW_QUERY_TEXT = /^[\x21-\x7E]{1,32768}$/;

/** Signs a raw query must not hold. */
const RAW_QUERY_BANNED = /[#<>"'\\]/;

/**
 * Whether a joined text may follow `?` verbatim.
 * @param text - Joined text.
 * @returns True for a valid raw query.
 */
function isRawQuery(text: JsonValue): text is string {
  if (typeof text !== 'string') return false;
  return RAW_QUERY_TEXT.test(text) && !RAW_QUERY_BANNED.test(text);
}

/**
 * Hydrate and check a step's raw query.
 * @param input - Step, scope and company.
 * @param raw - The step's raw query.
 * @returns The text, the join's failure, or `<step> raw query invalid`.
 */
function rawQueryOf(input: IStepUrlInput, raw: IJoinTemplate): Procedure<string> {
  const joined = hydrateJoin({ $join: raw }, input.scope);
  if (!isOk(joined)) return joined;
  if (isRawQuery(joined.value)) return succeed(joined.value);
  return fail(ScraperErrorTypes.Generic, `${input.step.name} raw query invalid`);
}

/**
 * Append a raw query after the URL's own query, or after a new `?`; a
 * fragment is dropped, since it never reaches the server.
 * @param url - Resolved step URL.
 * @param raw - Checked raw query.
 * @returns The URL with the raw query.
 */
function withRawQuery(url: string, raw: string): string {
  const [base] = url.split('#', 1);
  const glue = base.includes('?') ? '&' : '?';
  return `${base}${glue}${raw}`;
}

/**
 * Read an allowed absolute URL from carry; a relative or unapproved target
 * fails before it can reach the bus, even after an unchecked overwrite.
 * @param input - Step, scope and company.
 * @param slot - The step's `urlFromCarry` slot.
 * @returns The parsed URL, or `<step> carried url invalid`.
 */
function carriedUrl(input: IStepUrlInput, slot: string): Procedure<string> {
  const text = input.scope.carry[slot];
  const parsed = typeof text === 'string' ? URL.parse(text) : null;
  if (parsed !== null && matchesAnyUrlRule(parsed, input.carriedUrlRules ?? []))
    return succeed(parsed.href);
  return fail(ScraperErrorTypes.Generic, `${input.step.name} carried url invalid`);
}

/**
 * The URL a step sends to before any query: what its cookies bind to and its
 * relative answer URLs resolve against.
 * @param input - Step, scope and company.
 * @returns The carried URL, else the WK url, or the failure.
 */
function stepBaseUrlOf(input: IStepUrlInput): Procedure<string> {
  const slot = input.step.urlFromCarry;
  if (slot !== undefined) return carriedUrl(input, slot);
  return resolveWkUrl(input.step.urlTag, input.companyId);
}

/**
 * Resolve the URL a step sends to.
 * @param input - Step, scope and company.
 * @returns The step URL, or the first failure.
 */
function stepUrlOf(input: IStepUrlInput): Procedure<string> {
  const url = stepBaseUrlOf(input);
  const raw = input.step.rawQuery;
  if (!isOk(url) || raw === undefined) return url;
  const text = rawQueryOf(input, raw);
  if (!isOk(text)) return text;
  const withRaw = withRawQuery(url.value, text.value);
  return succeed(withRaw);
}

/**
 * Whether a step sends to its WK url as is: no carried URL, no raw query.
 * @param input - Step, scope and company.
 * @returns True for a plain step.
 */
function isPlainStep(input: IStepUrlInput): boolean {
  return input.step.urlFromCarry === undefined && input.step.rawQuery === undefined;
}

/**
 * What the fire hands the bus: a plain step's WK tag, else its resolved URL as
 * a literal. The URL is resolved once, by the caller, so the raw query it
 * signs is the one it sends.
 * @param input - Step, scope and company.
 * @param url - The step URL already resolved.
 * @returns The bus target.
 */
function sendTargetOf(input: IStepUrlInput, url: string): WKUrlOrLiteral {
  return isPlainStep(input) ? input.step.urlTag : literalUrl(url);
}

export type { IStepUrlInput };
export { sendTargetOf, stepBaseUrlOf, stepUrlOf };
