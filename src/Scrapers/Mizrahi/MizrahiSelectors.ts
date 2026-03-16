import { candidateToCss } from '../../Common/SelectorResolver.js';
import type { SelectorCandidate } from '../Base/Config/LoginConfig.js';

/** Selector config entry type. */
type SelectorConfig = Record<string, SelectorCandidate[]>;

/**
 * Build a selector map from scraper config — uses first candidate via resolver pipeline.
 * @param selectors - The selector config entries.
 * @returns A map of selector names to resolved selector strings.
 */
export default function buildSel(selectors: SelectorConfig): Record<string, string> {
  const entries = Object.entries(selectors);
  const mapped = entries.map(([key, candidates]) => {
    const resolved = candidateToCss(candidates[0]);
    return [key, resolved];
  });
  return Object.fromEntries(mapped) as Record<string, string>;
}
