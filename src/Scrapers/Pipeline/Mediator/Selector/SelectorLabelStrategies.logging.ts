/**
 * Shared logging + probe helpers for the SelectorLabelStrategies cluster.
 * Centralises the field/result and message diagnostic surfaces, plus the
 * exists→fillable→log triple used by xpath strategies.
 */

import type { Locator } from 'playwright-core';

import { getDebug } from '../../Types/Debug.js';
import { isFillableInput } from './SelectorLabelStrategies.elements.js';
import type { IProbeFillableOpts } from './SelectorLabelStrategies.types.js';

const LOG = getDebug(import.meta.url);

/**
 * Compact LOG.debug for {field, result} diagnostic pairs.
 * @param field - Field label tag (e.g. 'labelText:nested').
 * @param result - Discovery outcome.
 * @returns Sentinel `true` so the call can be expression-chained where needed.
 */
function logField(field: string, result: 'FOUND' | 'NOT_FOUND'): true {
  LOG.debug({ field, result });
  return true;
}

/**
 * Compact LOG.debug for {message} diagnostic strings.
 * @param message - Plain message to emit at DEBUG.
 * @returns Sentinel `true` so the call can be expression-chained where needed.
 */
function logMsg(message: string): true {
  LOG.debug({ message });
  return true;
}

/**
 * Extract an HTML attribute value from a locator, returning empty string when absent.
 * @param loc - The Playwright locator to query.
 * @param name - The attribute name.
 * @returns The attribute value, or empty string when the attribute is not present.
 */
async function extractAttrOrEmpty(loc: Locator, name: string): Promise<string> {
  const value = await loc.getAttribute(name);
  if (value === null) return String();
  return value;
}

/**
 * Probe an xpath/css selector: must exist AND be a fillable input.
 * Logs FOUND with the supplied field tag on success.
 * @param opts - Probe context bundle.
 * @returns Selector itself when found+fillable, empty string on miss.
 */
async function probeFillableLogField(opts: IProbeFillableOpts): Promise<string> {
  const { ctx, xpath, queryFn, fieldTag } = opts;
  const isFound = await queryFn(ctx, xpath);
  if (!isFound) return '';
  const isFill = await isFillableInput(ctx, xpath);
  if (!isFill) return '';
  logField(fieldTag, 'FOUND');
  return xpath;
}

/**
 * Chain async string-producing actions; return the first non-empty result.
 * @param actions - Lazy actions to try in order.
 * @returns First non-empty action result, or '' when all yield ''.
 */
async function chainFirstNonEmpty(actions: readonly (() => Promise<string>)[]): Promise<string> {
  const empty = Promise.resolve('');
  return actions.reduce<Promise<string>>(async (prev, action): Promise<string> => {
    const found = await prev;
    if (found) return found;
    return action();
  }, empty);
}

export { chainFirstNonEmpty, extractAttrOrEmpty, logField, logMsg, probeFillableLogField };
