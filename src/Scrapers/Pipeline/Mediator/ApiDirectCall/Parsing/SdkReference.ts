/**
 * Selects one allowlisted SDK reference from an active HTML document.
 */

import { ScraperErrorTypes } from '../../../../Base/ErrorTypes.js';
import { matchesAnyUrlRule } from '../../../Strategy/Fetch/UrlRule.js';
import type { IUrlRule } from '../../../Types/Domain/FetchPolicy.js';
import type { Procedure } from '../../../Types/Procedure.js';
import { fail, succeed } from '../../../Types/Procedure.js';
import { activeElements, attribute, isExecutableScript, scriptText } from './ActiveHtml.js';
import { queueSources } from './SdkQueue.js';

type HtmlElement = ReturnType<typeof activeElements>[number];

interface ISdkReferenceInput {
  readonly html: string;
  readonly answerUrl: string;
  readonly rules: readonly IUrlRule[];
}

/**
 * Resolves the first document base against the answering URL.
 * @param elements - Active document elements.
 * @param answerUrl - Actual answering URL.
 * @returns The effective base URL.
 */
function baseOf(elements: readonly HtmlElement[], answerUrl: string): URL {
  const base = elements.find(node => node.tagName === 'base' && attribute(node, 'href') !== false);
  const href = base ? attribute(base, 'href') : false;
  return new URL(href || answerUrl, answerUrl);
}

/**
 * Reads sources of an active script without executing its contents.
 * @param node - Active script element.
 * @returns Literal external or queued sources.
 */
function sourcesOf(node: HtmlElement): readonly string[] {
  const src = attribute(node, 'src');
  if (src !== false) return [src];
  const text = scriptText(node);
  return queueSources(text);
}

/**
 * Resolves one active script source or refuses a malformed one.
 * @param source - Unevaluated source attribute or queue literal.
 * @param base - Effective document base.
 * @returns Absolute source URL.
 */
function resolveSource(source: string, base: URL): URL {
  const url = URL.parse(source, base);
  if (source.trim() === '' || url === null) throw new TypeError('invalid script source');
  return url;
}

/**
 * Finds the unique allowlisted sources in a document.
 * @param input - Document and allowlist.
 * @returns The distinct matching URLs.
 */
function matchingSources(input: ISdkReferenceInput): readonly string[] {
  const elements = activeElements(input.html);
  const base = baseOf(elements, input.answerUrl);
  const sources = elements.filter(isExecutableScript).flatMap(sourcesOf);
  const urls = sources.map(source => resolveSource(source, base));
  const candidates = urls.filter(url => matchesAnyUrlRule(url, input.rules)).map(url => url.href);
  return [...new Set(candidates)];
}

/**
 * Decides whether the page names exactly one allowed SDK.
 * @param input - Document and allowlist.
 * @returns The selected URL, or a refusal.
 */
function selectReference(input: ISdkReferenceInput): Procedure<string> {
  const unique = matchingSources(input);
  if (unique.length === 1) return succeed(unique[0]);
  return fail(ScraperErrorTypes.Generic, 'SDK reference missing or ambiguous');
}

/**
 * Selects one absolute, allowlisted reference from active script sources.
 * @param input - Document, answering URL and allowed URL rules.
 * @returns The unique matching URL, or a value-free refusal.
 */
function captureSdkReference(input: ISdkReferenceInput): Procedure<string> {
  try {
    return selectReference(input);
  } catch {
    return fail(ScraperErrorTypes.Generic, 'SDK reference invalid');
  }
}

export default captureSdkReference;
export { captureSdkReference };
