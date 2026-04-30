/**
 * withTrace — higher-order wrapper for scrape iteration tracing.
 * Emits scrape-card events before and after each fetch call.
 * Captures durationMs and status for the Flight Recorder.
 * Used by ProxyScrapeReplayStrategy and MatrixLoopStrategy.
 */

import type { ITransaction } from '../../../../Transactions.js';
import { getDebug } from '../../Types/Debug.js';

/** Number of transactions returned from a traced iteration. */
type TracedTxnCount = number;
/** Elapsed time in milliseconds. */
type ElapsedMs = number;
/** Trace outcome status. */
type TraceOutcome = 'ok' | 'empty' | 'error';

/** Status lookup: has txns → ok, else → empty. */
const STATUS_MAP: Record<string, TraceOutcome> = { true: 'ok', false: 'empty' };

const LOG = getDebug(import.meta.url);

/**
 * Wrap an async card×month iteration with entry/exit scrape-card events.
 * Emits duration and status on exit for observability.
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
  LOG.trace({ card, month, txnCount: 0 });
  const startMs = Date.now();
  try {
    const txns = await fn();
    const count: TracedTxnCount = txns.length;
    const durationMs: ElapsedMs = Date.now() - startMs;
    const hasTxns = String(count > 0);
    const status = STATUS_MAP[hasTxns];
    LOG.trace({ card, month, txnCount: count, durationMs, status });
    return txns;
  } catch (err) {
    const durationMs: ElapsedMs = Date.now() - startMs;
    LOG.trace({ card, month, txnCount: 0, durationMs, status: 'error' });
    throw err;
  }
}

export default withTrace;
export { withTrace };
