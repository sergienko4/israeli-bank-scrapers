/**
 * Walk-up text strategies: locate an interactive ancestor or a nearby input
 * container starting from a visible text node. Used for textContent candidates.
 */

import type { Frame, Page } from 'playwright-core';

import { maskVisibleText } from '../../Types/LogEvent.js';
import {
  chainFirstNonEmpty,
  logField,
  probeFillableLogField,
} from './SelectorLabelStrategies.logging.js';
import type { IAncestorProbeOpts, QueryFn } from './SelectorLabelStrategies.types.js';

/** XPath filter to exclude non-fillable input types. */
const NON_FILLABLE_FILTER =
  'not(@type="hidden") and not(@type="submit") and not(@type="button") ' +
  'and not(@type="radio") and not(@type="checkbox")';

/** Interactive ancestor tags that a text node can walk up to. */
const INTERACTIVE_ANCESTORS = ['button', 'a', 'select'] as const;

/**
 * Build the XPath that walks from a text node to the nearest container input.
 * @param textValue - The visible text to match.
 * @returns The container-input XPath selector.
 */
function buildContainerInputXpath(textValue: string): string {
  return (
    `xpath=//*[text()[contains(., "${textValue}")]]/` +
    `ancestor::*[.//input[${NON_FILLABLE_FILTER}]][1]//input[${NON_FILLABLE_FILTER}][1]`
  );
}

/**
 * Find the nearest fillable input from a text node by walking up the DOM.
 * @param ctx - The Playwright Page or Frame to search in.
 * @param textValue - The visible text to search for.
 * @param queryFn - A function that checks element existence with a timeout.
 * @returns The XPath selector for the container input, or '' if not found.
 */
async function resolveByContainerInput(
  ctx: Page | Frame,
  textValue: string,
  queryFn: QueryFn,
): Promise<string> {
  const xpath = buildContainerInputXpath(textValue);
  const fieldTag = `textContent:${maskVisibleText(textValue)}`;
  return probeFillableLogField({ ctx, xpath, queryFn, fieldTag });
}

/**
 * Probe one interactive ancestor tag — emits a FOUND log on hit.
 * @param opts - The ancestor probe options.
 * @param tag - The HTML tag name to search for.
 * @returns The xpath selector when found, '' on miss.
 */
async function probeAncestorTag(opts: IAncestorProbeOpts, tag: string): Promise<string> {
  const xpath = `xpath=//${tag}[.//text()[contains(., "${opts.textValue}")]]`;
  const isFound = await opts.queryFn(opts.ctx, xpath);
  if (!isFound) return '';
  const masked = maskVisibleText(opts.textValue);
  logField(`textContent:${masked}`, 'FOUND');
  return xpath;
}

/**
 * Build a lazy action that probes a single ancestor tag for a text value.
 * @param opts - The ancestor probe options.
 * @param tag - The HTML tag name to search for.
 * @returns An async function that resolves to a selector or empty string.
 */
function buildAncestorProbe(opts: IAncestorProbeOpts, tag: string): () => Promise<string> {
  return (): Promise<string> => probeAncestorTag(opts, tag);
}

/**
 * Try each interactive ancestor tag in order; return the first match.
 * @param opts - Ancestor probe options.
 * @returns First non-empty selector or '' if none matched.
 */
async function tryAncestorTags(opts: IAncestorProbeOpts): Promise<string> {
  const actions = INTERACTIVE_ANCESTORS.map((tag): (() => Promise<string>) =>
    buildAncestorProbe(opts, tag),
  );
  return chainFirstNonEmpty(actions);
}

/**
 * Walk up from a text node to find the nearest interactive ancestor.
 * @param ctx - The Playwright Page or Frame to search in.
 * @param textValue - The visible text to search for.
 * @param queryFn - A function that checks element existence with a timeout.
 * @returns The XPath selector for the interactive ancestor, or '' if not found.
 */
async function resolveByAncestorWalkUp(
  ctx: Page | Frame,
  textValue: string,
  queryFn: QueryFn,
): Promise<string> {
  return tryAncestorTags({ ctx, textValue, queryFn });
}

/**
 * Resolve a textContent candidate: walk up to interactive element, else nearby input.
 * @param ctx - The Playwright Page or Frame to search in.
 * @param textValue - The visible text to search for.
 * @param queryFn - A function that checks element existence with a timeout.
 * @returns The resolved selector, or empty string if not found.
 */
async function resolveTextContent(
  ctx: Page | Frame,
  textValue: string,
  queryFn: QueryFn,
): Promise<string> {
  const interactive = await resolveByAncestorWalkUp(ctx, textValue, queryFn);
  if (interactive) return interactive;
  return resolveByContainerInput(ctx, textValue, queryFn);
}

export {
  NON_FILLABLE_FILTER,
  resolveByAncestorWalkUp,
  resolveByContainerInput,
  resolveTextContent,
};
