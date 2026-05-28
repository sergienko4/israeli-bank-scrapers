/**
 * CANARY — T50: SCRAPE phase MUST NOT reference balance aliases or
 * the BALANCE-RESOLVE module.
 *
 * <p>The v5 isolation architecture forbids the SCRAPE zone
 * (`src/Scrapers/Pipeline/Strategy/Scrape/**`, excluding the
 * `Account/BalanceExtractor.ts` re-export shim) from importing:
 * <ul>
 *   <li>{@code PIPELINE_BALANCE_ALIASES} or any symbol from
 *       `src/Scrapers/Pipeline/Registry/WK/BalanceResolveWK.ts`.</li>
 *   <li>{@code runBalanceExtractor} or any symbol from
 *       `src/Scrapers/Pipeline/Mediator/BalanceResolve/**`.</li>
 *   <li>The literal string {@code 'balance'} inside
 *       `src/Scrapers/Pipeline/Strategy/Scrape/ScrapeDataActions.ts`
 *       outside code comments — proves the v4 removal stuck.</li>
 * </ul>
 *
 * <p>This file deliberately violates the rules so {@code verify.sh}
 * can confirm `no-restricted-imports` and `no-restricted-syntax`
 * fire. If the rules degrade, SCRAPE could quietly reintroduce
 * balance-resolution logic and the single-source-of-truth contract
 * (BALANCE-RESOLVE owns balance) would silently rot.
 *
 * <p>Applicable guidelines:
 * <ul>
 *   <li>`design-patterns-guidlines.md` — "Prefer extension over
 *       modification."</li>
 *   <li>`general-rules-guidlines.md` — "All extensions must be
 *       additive (open–closed principle)."</li>
 *   <li>`coding-principle-guidlines.md` §5 — SOLID Open/Closed.</li>
 * </ul>
 */

// Deliberate violation #1 — SCRAPE must not import balance aliases.
import { PIPELINE_BALANCE_ALIASES } from '../Registry/WK/BalanceResolveWK.js';
// Deliberate violation #2 — SCRAPE must not import the balance extractor.
import { runBalanceExtractor } from '../Mediator/BalanceResolve/BalanceExtractor.js';

// Deliberate violation #3 — bare literal 'balance' outside a comment.
const FORBIDDEN_KEY = 'balance';

/**
 * Anchor — keeps the forbidden imports live so the lint pass sees them.
 * @returns Always `'canary'`.
 */
function anchor(): string {
  return `${String(PIPELINE_BALANCE_ALIASES.length)}-${String(runBalanceExtractor({}))}-${FORBIDDEN_KEY}`;
}

export { anchor };
