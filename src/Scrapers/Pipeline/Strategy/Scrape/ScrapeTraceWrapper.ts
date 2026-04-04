/**
 * withTrace — higher-order wrapper for scrape iteration tracing.
 * Emits scrape-card events before and after each fetch call.
 * Used by ProxyScrapeReplayStrategy and MatrixLoopStrategy.
 */

import type { ITransaction } from '../../../../Transactions.js';
import { getDebug } from '../../Types/Debug.js';

/** Number of transactions returned from a traced iteration. */
type TracedTxnCount = number;

const LOG = getDebug('scrape-trace');

/**
 * Wrap an async card×month iteration with entry/exit scrape-card events.
 * @param card - Card index being replayed.
 * @param month - Billing month being fetched.
 * @param fn - The actual fetch function.
 * @returns Transactions from fn, with trace events emitted.
 */
async function withTrace(
  card: string,
  month: string,
  fn: () => Promise<readonly ITransaction[]>,
): Promise<readonly ITransaction[]> {
  LOG.trace({ event: 'scrape-card', card, month, txnCount: 0 });
  const txns = await fn();
  const count: TracedTxnCount = txns.length;
  LOG.trace({ event: 'scrape-card', card, month, txnCount: count });
  return txns;
}

export default withTrace;
export { withTrace };
