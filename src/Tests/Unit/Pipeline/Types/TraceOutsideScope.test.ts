/**
 * Boundary behavior outside every run scope. The trace module no longer keeps
 * a process-global bank, so callers that run before a scrape must get the
 * empty-artefact contract rather than a stale fallback.
 */

import { retireRunLogger } from '../../../../Scrapers/Pipeline/Logging/RootLogger.js';
import {
  closeActiveRunTrace,
  getActiveRunId,
  getLogFile,
} from '../../../../Scrapers/Pipeline/Types/TraceConfig.js';

describe('trace outside a run scope', () => {
  it('reports no run identity or log destination', () => {
    const runId = getActiveRunId();
    const logFile = getLogFile();
    expect(runId).toBe('');
    expect(logFile).toBe('');
  });

  it('closes an absent scope and retires no logger', () => {
    const didClose = closeActiveRunTrace();
    const didRetire = retireRunLogger();
    expect(didClose).toBe(true);
    expect(didRetire).toBe(false);
  });
});
