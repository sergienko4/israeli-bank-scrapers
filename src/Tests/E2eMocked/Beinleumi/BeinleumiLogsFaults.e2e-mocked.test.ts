/**
 * Beinleumi browserless logs, bank faults (AD-N12) — no password, code, user
 * or account name, Transmit token, authorization, envelope key, device or
 * session id, SSO code, cookie or bank text reaches a log line or a failure
 * message, across the success, SMS and every bank fault fixture. Every
 * pipeline logger is swapped for a real pino logger at `trace` with the
 * production redaction config. The caller-outcome runs live in
 * BeinleumiLogs; the split lets the two suites run on separate workers.
 *
 * Rule #18: all credentials + data are synthetic; no real PII.
 */

import { jest } from '@jest/globals';

import { capturingDebugModule, LOG_LINES } from './BeinleumiLogCapture.js';

jest.unstable_mockModule('../../../Scrapers/Pipeline/Logging/Debug.js', capturingDebugModule);

const ORACLE = await import('./BeinleumiLogOracle.js');
const RUN = await import('./BeinleumiRun.js');

describe('Beinleumi browserless logs on bank faults (AD-N12)', () => {
  beforeEach((): void => {
    LOG_LINES.length = 0;
  });

  it.each(ORACLE.FAULT_RUNS)(
    'logs and reports no secret on the $label run',
    async ({ fault, setup, states }) => {
      const run = await RUN.runBeinleumi(fault, setup);
      const leaks = ORACLE.leaksOf(run, LOG_LINES);
      const held = ORACLE.statesOf(run);
      expect(run.state.violations).toEqual([]);
      expect(LOG_LINES.length).toBeGreaterThan(0);
      expect(held).toHaveLength(states);
      expect(leaks).toEqual({ logged: [], reported: [] });
    },
  );
});
