/**
 * Derivation ops: the last shaping of a derived text. `format` takes
 * the first rule whose pattern, anchored at both ends, matches the whole
 * text, and returns the rule's prefix plus the text left-padded with `'0'`
 * to `padStart` chars; no match fails `<subject> unformattable`, naming the
 * slot and never the text. `md5-hex` returns the MD5 digest of the UTF-8
 * text as lower-case hex: the bank's protocol checks it, nothing here
 * relies on it for secrecy. `url-query` reads one safe value from a URL.
 */

import { createHash } from 'node:crypto';

import { ScraperErrorTypes } from '../../../../../Base/ErrorTypes.js';
import { matchesAnyUrlRule } from '../../../../Strategy/Fetch/UrlRule.js';
import type { Procedure } from '../../../../Types/Procedure.js';
import { fail, succeed } from '../../../../Types/Procedure.js';
import type {
  DerivedOp,
  IFormatOp,
  IFormatRule,
  IUrlPathMapOp,
  IUrlQueryOp,
} from '../../ConfigContracts/index.js';
import { runUrlCompose } from '../FlowUrlCompose.js';
import { queryValue } from '../FlowUrlQuery.js';

/** The text an op shapes, the subject its failure names, and the op. */
interface IOpInput {
  readonly text: string;
  readonly parts: readonly string[];
  readonly subject: string;
  readonly op?: DerivedOp;
}

/** Runs one op kind. */
type OpRunner<TOp extends DerivedOp> = (input: IOpInput, op: TOp) => Procedure<string>;

/**
 * Compile a regex source with the `u` flag.
 * @param source - Regex source.
 * @returns The regex, or false when it does not compile.
 */
function compiledPattern(source: string): RegExp | false {
  try {
    return new RegExp(source, 'u');
  } catch {
    return false;
  }
}

/**
 * Compile a format pattern anchored at both ends. The pattern must compile
 * alone first, so the wrapping group cannot change what it means.
 * @param pattern - Format rule pattern.
 * @returns The anchored regex, or false when the pattern does not compile.
 */
function anchoredPattern(pattern: string): RegExp | false {
  if (compiledPattern(pattern) === false) return false;
  return compiledPattern(`^(?:${pattern})$`);
}

/**
 * Whether a format rule matches the whole text.
 * @param rule - Format rule.
 * @param text - Derived text.
 * @returns True on a whole match.
 */
function isWholeMatch(rule: IFormatRule, text: string): boolean {
  const anchored = anchoredPattern(rule.pattern);
  return anchored !== false && anchored.test(text);
}

/**
 * Shape the text by the first rule that matches it whole.
 * @param input - Text and failure subject.
 * @param op - Format op.
 * @returns The prefixed, padded text, or the unformattable failure.
 */
function runFormat(input: IOpInput, op: IFormatOp): Procedure<string> {
  const rule = op.rules.find((candidate): boolean => isWholeMatch(candidate, input.text));
  if (rule === undefined) return fail(ScraperErrorTypes.Generic, `${input.subject} unformattable`);
  const padded = input.text.padStart(rule.padStart ?? 0, '0');
  return succeed(`${rule.prefix}${padded}`);
}

/**
 * Digest the UTF-8 text with MD5.
 * @param input - Text to digest.
 * @returns Lower-case hex digest.
 */
function runMd5Hex(input: IOpInput): Procedure<string> {
  const digest = createHash('md5').update(input.text, 'utf8').digest('hex');
  return succeed(digest);
}

/**
 * Derive a query value without exposing the source URL in errors.
 * @param input - Text and failure subject.
 * @param op - Query key configuration.
 * @returns The value, or the subject's unformattable failure.
 */
function runUrlQuery(input: IOpInput, op: IUrlQueryOp): Procedure<string> {
  const value = queryValue(input.text, op.key);
  if (value === false) return fail(ScraperErrorTypes.Generic, `${input.subject} unformattable`);
  const policy: unknown = Reflect.get(op, 'rejectBlank');
  if (policy !== undefined && policy !== true)
    return fail(ScraperErrorTypes.Generic, `${input.subject} unformattable`);
  if (policy === true && value.trim() === '')
    return fail(ScraperErrorTypes.Generic, `${input.subject} unformattable`);
  return succeed(value);
}

/**
 * Selects an allowed path while preserving the original query.
 * @param text - Source URL.
 * @param op - Source, target and query-value policies.
 * @returns Checked URL, or false for an unsafe route.
 */
function mappedUrl(text: string, op: IUrlPathMapOp): string | false {
  const key = queryValue(text, op.key);
  const parsed = URL.parse(text);
  if (key === false || parsed === null || !Object.hasOwn(op.paths, key)) return false;
  if (!matchesAnyUrlRule(parsed, op.source)) return false;
  parsed.pathname = op.paths[key];
  return matchesAnyUrlRule(parsed, op.url) ? parsed.href : false;
}

/**
 * Derives a checked URL without exposing its contents in failures.
 * @param input - Source URL and failure subject.
 * @param op - Path mapping policy.
 * @returns Mapped URL or a value-free refusal.
 */
function runUrlPathMap(input: IOpInput, op: IUrlPathMapOp): Procedure<string> {
  const url = mappedUrl(input.text, op);
  if (url === false) return fail(ScraperErrorTypes.Generic, `${input.subject} unformattable`);
  return succeed(url);
}

/** One runner per op kind. */
const OP_RUNNERS: { [TKind in DerivedOp['kind']]: OpRunner<Extract<DerivedOp, { kind: TKind }>> } =
  {
    format: runFormat,
    'md5-hex': runMd5Hex,
    'url-query': runUrlQuery,
    'url-path-map': runUrlPathMap,
    'url-compose': runUrlCompose,
  };

/**
 * Apply a derivation's op, if it names one.
 * @param input - Text, failure subject and the optional op.
 * @returns The shaped text, or the op's failure.
 */
function applyDerivedOp(input: IOpInput): Procedure<string> {
  const derivedOp = input.op;
  if (derivedOp === undefined) return succeed(input.text);
  const run = OP_RUNNERS[derivedOp.kind] as OpRunner<DerivedOp>;
  return run(input, derivedOp);
}

export { isQueryKey } from '../FlowUrlQuery.js';
export { anchoredPattern, applyDerivedOp };
export type { IOpInput };
