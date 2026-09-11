/**
 * An account whose window verdict is known.
 *
 * <p>Separate from {@link ITransactionsAccount} because the public field is
 * optional — absent there means "no audit ran", which is true of the browser
 * scrape strategies. Inside a phase that *does* run the audit, absent can only
 * mean the verdict was computed and then dropped, which is the defect issue
 * #553 reports. Requiring it here makes that a compile error rather than a
 * silent omission a reader has to notice.
 */

import type { ITransactionsAccount } from '../../../../Transactions.js';
import type { IWindowCoverage } from '../../../../WindowCoverage.js';

/** A transactions account that carries its window verdict. */
export interface IAuditedAccount extends ITransactionsAccount {
  /** What this account may honestly claim about the requested window. */
  readonly windowCoverage: IWindowCoverage;
}
