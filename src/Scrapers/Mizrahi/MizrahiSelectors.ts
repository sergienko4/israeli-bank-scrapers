import { toFirstCss } from '../../Common/SelectorResolver.js';
import type { SelectorCandidate } from '../Base/LoginConfig.js';

/** Selector config entry type. */
type SelectorConfig = Record<string, SelectorCandidate[]>;

/**
 * Build a CSS selector map from scraper config selectors.
 * @param selectors - The selector config entries.
 * @returns A map of selector names to CSS strings.
 */
export default function buildSel(selectors: SelectorConfig): Record<string, string> {
  const entries = Object.entries(selectors);
  const mapped = entries.map(([key, candidates]) => {
    const css = toFirstCss(candidates);
    return [key, css];
  });
  return Object.fromEntries(mapped) as Record<string, string>;
}
