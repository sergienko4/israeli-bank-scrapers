/**
 * Billing-cycle domain types — split out of PipelineContext.ts
 * for Phase 1 god-file decoupling.
 *
 * Public surface (re-exported via PipelineContext.ts barrel):
 *  - IBillingCycle, IBillingCycleCatalog
 */

/**
 * One billing cycle for a credit card.
 *
 * <p>Normalised shape produced by the bank-agnostic cycle-catalog
 * detector. Source SPAs use different field names (`billingDate`
 * + `isFinalBillingDate` on Backbase; `Date` +
 * `IsFinnal` on Max; `cycleOpeningDate` + `cycleClosingDate`
 * on VisaCal) — the detector folds all of them into this single
 * canonical record so SCRAPE consumes one shape.
 *
 * <p>{@link cards} is populated when the source response scopes the
 * cycle to specific cards (VisaCal). It is omitted when the source
 * reports a single global cycle list per account (Backbase / Max).
 */
interface IBillingCycle {
  readonly billingDate: string;
  readonly isOpen: boolean;
  readonly cards?: readonly string[];
}

/**
 * Authoritative list of billing cycles for the scrape window.
 *
 * <p>When present, replaces the blind `generateMonthChunks`
 * iteration in SCRAPE — the bank itself told us which cycles exist
 * and which one is currently OPEN. Absent `billingCycleCatalog`
 * means the bank does not expose a cycle structure (current
 * accounts).
 */
interface IBillingCycleCatalog {
  readonly cycles: readonly IBillingCycle[];
}

export type { IBillingCycle, IBillingCycleCatalog };
