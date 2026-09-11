/**
 * Window-coverage diagnostic precedence.
 */

import { jest } from '@jest/globals';

const LOG = {
  trace: jest.fn(),
  debug: jest.fn(),
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
};

jest.unstable_mockModule('../../../../../Scrapers/Pipeline/Logging/Debug.js', async () => ({
  ...(await import('../../../../../Scrapers/Pipeline/Types/MockTiming.js')),
  ...(await import('../../../../../Scrapers/Pipeline/Logging/BankContext.js')),
  /**
   * Supply the shared logger to the module under test.
   * @returns Shared logger mock.
   */
  getDebug: (): typeof LOG => LOG,
  /**
   * Preserve the legacy logger factory surface.
   * @returns Shared logger mock.
   */
  getDebugByName: (): typeof LOG => LOG,
}));

const COVERAGE =
  await import('../../../../../Scrapers/Pipeline/Mediator/Scrape/CoverageAudit/WindowCoverage.js');

describe('assessWindowCoverage diagnostics', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('reports an unreadable requested start before missing row dates', () => {
    const result = COVERAGE.assessWindowCoverage({
      requestedStart: 'not-a-date',
      rows: [],
      label: 'test/txns',
    });
    const warning = JSON.stringify(LOG.warn.mock.calls);
    expect(result.verdict).toBe('unproven');
    expect(warning).toContain('requested start unreadable');
    expect(warning).not.toContain('no row carried a usable date');
  });
});
