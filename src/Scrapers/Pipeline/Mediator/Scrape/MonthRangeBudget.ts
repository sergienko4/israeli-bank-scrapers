import type { IBankMonth } from './BankMonth.js';

/**
 * Maximum monthly requests one generated plan may schedule.
 *
 * This matches the paginator's runaway ceiling while stopping eager month-plan
 * construction before it can overflow the stack or enqueue decades of work.
 */
const MAX_MONTH_REQUESTS = 300;

/**
 * Convert a bank month to a monotonic month index.
 * @param value - Validated bank month.
 * @returns Month index suitable for distance calculations.
 */
function monthIndex(value: IBankMonth): number {
  return value.year * 12 + value.month - 1;
}

/**
 * Count an inclusive month range when it fits the provider request budget.
 * @param first - First requested month.
 * @param last - Last requested month.
 * @returns Month count, zero for a reversed range, or false when unsafe.
 */
function boundedMonthCount(first: IBankMonth, last: IBankMonth): number | false {
  const count = monthIndex(last) - monthIndex(first) + 1;
  if (!Number.isSafeInteger(count) || count > MAX_MONTH_REQUESTS) return false;
  return Math.max(0, count);
}

/**
 * Whether a prepared monthly request plan fits the shared provider budget.
 * @param plan - Validated monthly requests ready to schedule.
 * @returns True when the whole plan can run without truncation.
 */
function fitsMonthRequestBudget(plan: readonly unknown[]): boolean {
  return plan.length <= MAX_MONTH_REQUESTS;
}

export { boundedMonthCount, fitsMonthRequestBudget, MAX_MONTH_REQUESTS };
