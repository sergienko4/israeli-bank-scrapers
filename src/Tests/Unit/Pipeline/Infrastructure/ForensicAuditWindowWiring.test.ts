/**
 * The window-completeness verdict is actually wired into the forensic audit.
 *
 * `logWindowCompleteness` is covered directly, but that says nothing about
 * whether the run-level audit calls it. It is invoked for its log line alone
 * and its return value is discarded, so deleting the call changes no result
 * and no other test notices — `logForensicAudit` keeps returning `true` while
 * the shortfall alarm silently stops existing. These cases read the emitted
 * line through the real audit, so the wiring cannot be removed without going
 * red.
 */

import { jest } from '@jest/globals';

/** Single logger instance shared by the modules under test and the assertions. */
const LOG = {
  trace: jest.fn(),
  debug: jest.fn(),
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
};

jest.unstable_mockModule('../../../../Scrapers/Pipeline/Logging/Debug.js', async () => ({
  ...(await import('../../../../Scrapers/Pipeline/Types/MockTiming.js')),
  ...(await import('../../../../Scrapers/Pipeline/Logging/BankContext.js')),
  /**
   * Pipeline modules derive their logger from `import.meta.url`.
   * @returns The shared mock logger, so its calls are visible here.
   */
  getDebug: (): typeof LOG => LOG,
  /**
   * Legacy entry point, present so the mock covers the module's full surface.
   * @returns The shared mock logger.
   */
  getDebugByName: (): typeof LOG => LOG,
}));

const AUDIT = await import('../../../../Scrapers/Pipeline/Mediator/Scrape/ForensicAuditAction.js');
const FACTORIES = await import('./MockFactories.js');
const OPTION = await import('../../../../Scrapers/Pipeline/Types/Option.js');

/**
 * Every line emitted so far at any level, joined for a substring assertion.
 * @returns The text of all log calls this test produced.
 */
function emitted(): string {
  const levels = [LOG.debug, LOG.info, LOG.warn, LOG.error];
  const calls = levels.flatMap((level: jest.Mock) => level.mock.calls as unknown[][]);
  const rendered = calls.map((call: unknown[]) => JSON.stringify(call));
  return rendered.join('\n');
}

/**
 * A pipeline context carrying a committed scrape and nothing else.
 * @param isExhausted - Whether backfill was spent without covering the window.
 * @returns Context ready for the run-level audit.
 */
function ctxWith(isExhausted: boolean): Parameters<typeof AUDIT.logForensicAudit>[0] {
  const scrape = { accounts: [], backfillExhausted: isExhausted };
  return FACTORIES.makeMockContext({ scrape: OPTION.some(scrape) });
}

beforeEach(() => {
  LOG.debug.mockClear();
  LOG.info.mockClear();
  LOG.warn.mockClear();
  LOG.error.mockClear();
});

describe('logForensicAudit — window verdict wiring', () => {
  it('reports the shortfall when backfill was spent short of the window', () => {
    const ctx = ctxWith(true);
    AUDIT.logForensicAudit(ctx);
    const said = emitted();
    expect(said).toContain('EXHAUSTED - backfill spent');
  });

  it('records the clear verdict when no shortfall was observed', () => {
    const ctx = ctxWith(false);
    AUDIT.logForensicAudit(ctx);
    const said = emitted();
    expect(said).toContain('WINDOW | NOT_EXHAUSTED');
  });
});
