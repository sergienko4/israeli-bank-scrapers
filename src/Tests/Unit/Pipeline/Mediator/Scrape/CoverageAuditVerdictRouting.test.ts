/**
 * The coverage verdict is actually routed by severity, not just worded by it.
 *
 * `isUnaudited` is covered directly, but that says nothing about which channel
 * carries the result. The verdict exists only as a log line — its return value
 * is discarded by every caller — so reverting the routing to
 * `result.unread === 0` changes no count and no other assertion notices. The
 * suite keeps passing while an unproven round silently drops back to `debug`,
 * which is exactly the invisibility this guardrail was written to end.
 *
 * These cases read the emitted line and the channel it came from, so the
 * routing cannot be weakened without going red. Bodies are synthetic — zero
 * PII.
 */

import { jest } from '@jest/globals';

/**
 * Build the logger mock the module under test writes through.
 *
 * Every level is stubbed rather than only the two the routing uses, so a
 * verdict rerouted to `info` or `error` surfaces as a missing `warn` here
 * instead of throwing on an undefined method and reading as an unrelated crash.
 *
 * @returns Logger stub whose levels are all jest mocks.
 */
function makeMockLogger(): Record<'trace' | 'debug' | 'info' | 'warn' | 'error', jest.Mock> {
  return {
    trace: jest.fn(),
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  };
}

/** Single logger instance shared by the module under test and the assertions. */
const LOG = makeMockLogger();

jest.unstable_mockModule('../../../../../Scrapers/Pipeline/Logging/Debug.js', async () => ({
  ...(await import('../../../../../Scrapers/Pipeline/Types/MockTiming.js')),
  ...(await import('../../../../../Scrapers/Pipeline/Logging/BankContext.js')),
  /**
   * The audit derives its logger from `import.meta.url`.
   * @returns The shared mock logger, so its calls are visible here.
   */
  getDebug: (): typeof LOG => LOG,
  /**
   * Legacy entry point, present so the mock covers the module's full surface.
   * @returns The shared mock logger.
   */
  getDebugByName: (): typeof LOG => LOG,
}));

const AUDIT =
  await import('../../../../../Scrapers/Pipeline/Mediator/Scrape/CoverageAudit/CoverageAudit.js');

/**
 * One transaction row in the shape the auto-mapper recognises.
 * @param name - Merchant name, the row's identity in the mapped key.
 * @param amount - Charged amount.
 * @returns A synthetic row.
 */
function txn(name: string, amount: number): Record<string, unknown> {
  return { purchaseDate: '2026-06-02', businessName: name, billingAmount: amount };
}

/**
 * Run a reconciliation round through the real audit.
 * @param body - Response body.
 * @param extracted - Rows the shape returned.
 * @returns The counts the audit produced, so a caller can assert on both.
 */
function audit(body: object, extracted: readonly object[]): ReturnType<typeof AUDIT.auditCoverage> {
  return AUDIT.auditCoverage({ body, extracted, label: 'bank/txns' });
}

/**
 * Every line emitted on one channel, joined for a substring assertion.
 * @param channel - Logger method to read.
 * @returns The text of that channel's calls.
 */
function emitted(channel: 'debug' | 'warn'): string {
  const level: jest.Mock = LOG[channel];
  const rendered = level.mock.calls.map((call: unknown[]) => JSON.stringify(call));
  return rendered.join('\n');
}

describe('coverage verdict routing', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('warns when the round proved nothing, rather than passing it off as clean', () => {
    // The whole point of the flag. `unread` is zero here exactly as it is on a
    // healthy round, so severity is the only thing separating "nothing was
    // comparable" from "everything agreed". If this drops back to debug the
    // verdict is invisible again and the flag buys nothing.
    audit({ data: { errorCode: '0' } }, [txn('SHOP', 10)]);
    const warned = emitted('warn');
    expect(warned).toContain('UNAUDITED');
    expect(LOG.debug).not.toHaveBeenCalled();
  });

  it('stays quiet on a round that genuinely reconciled', () => {
    // Healthy traffic must not reach the warning channel: a guardrail that
    // fires on success is one operators learn to filter out.
    const rows = [txn('SHOP', 10)];
    audit({ transactions: rows }, rows);
    const logged = emitted('debug');
    expect(logged).toContain('complete');
    expect(LOG.warn).not.toHaveBeenCalled();
  });

  it('stays quiet when the response carried nothing to reconcile', () => {
    // An empty period is a legitimate answer, not a blind round. Warning here
    // would make the flag fire on every account with no activity.
    audit({ data: { errorCode: '0' } }, []);
    const logged = emitted('debug');
    expect(logged).toContain('complete');
    expect(LOG.warn).not.toHaveBeenCalled();
  });

  it('still warns on a genuine shortfall', () => {
    // The pre-existing alarm must survive the new branch ordering: a real
    // missed container is not to be reclassified as merely unaudited.
    const read = [txn('SHOP', 10)];
    const body = { visible: read, archive: [txn('STREAMING CO', 30)] };
    audit(body, read);
    const warned = emitted('warn');
    expect(warned).toContain('INCOMPLETE');
    expect(LOG.debug).not.toHaveBeenCalled();
  });
});
