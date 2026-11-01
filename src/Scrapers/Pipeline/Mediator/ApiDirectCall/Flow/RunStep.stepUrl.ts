/**
 * Step URL — the URL a step sends to: its WK url, with its raw query (N41)
 * after `?` verbatim. The fire hands the bus a raw-query step's URL as a
 * literal and any other step's WK tag, as before.
 */

import { ScraperErrorTypes } from '../../../../Base/ErrorTypes.js';
import { literalUrl, resolveWkUrl, type WKUrlOrLiteral } from '../../../Registry/WK/UrlsWK.js';
import type { Procedure } from '../../../Types/Procedure.js';
import { fail, isOk, succeed } from '../../../Types/Procedure.js';
import type { IJoinTemplate } from '../ConfigContracts/index.js';
import { hydrateJoin } from '../Template/JoinTemplate.js';
import type { IRunStepArgs, JsonValue } from './RunStep.types.js';

/** What resolves a step's URL: the step, its scope and its company. */
type IStepUrlInput = Pick<IRunStepArgs, 'step' | 'scope' | 'companyId'>;

/** One to 32 768 printable-ASCII chars (N41). */
const RAW_QUERY_TEXT = /^[\x21-\x7E]{1,32768}$/;

/** Signs a raw query must not hold (N41). */
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
 * Resolve the URL a step sends to.
 * @param input - Step, scope and company.
 * @returns The step URL, or the first failure.
 */
function stepUrlOf(input: IStepUrlInput): Procedure<string> {
  const url = resolveWkUrl(input.step.urlTag, input.companyId);
  const raw = input.step.rawQuery;
  if (!isOk(url) || raw === undefined) return url;
  const text = rawQueryOf(input, raw);
  if (!isOk(text)) return text;
  const withRaw = withRawQuery(url.value, text.value);
  return succeed(withRaw);
}

/**
 * What the fire hands the bus: a plain step's WK tag, else its URL as a literal.
 * @param input - Step, scope and company.
 * @returns The bus target, or the step URL's failure.
 */
function sendTargetOf(input: IStepUrlInput): Procedure<WKUrlOrLiteral> {
  if (input.step.rawQuery === undefined) return succeed(input.step.urlTag);
  const url = stepUrlOf(input);
  if (!isOk(url)) return url;
  const literal = literalUrl(url.value);
  return succeed(literal);
}

export type { IStepUrlInput };
export { sendTargetOf, stepUrlOf };
