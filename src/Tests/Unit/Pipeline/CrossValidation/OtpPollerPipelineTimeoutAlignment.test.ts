/**
 * Cross-validation regression — Beinleumi 2026-05-07.
 *
 * The real-E2E OTP poller (`OtpPoller.DEFAULT_POLL_TIMEOUT_MS`) MUST NOT
 * cut off before the pipeline OTP watchdog
 * (`OtpFillPhaseActions.DEFAULT_OTP_TIMEOUT_MS`). When the test default
 * is shorter than the pipeline default, the retriever rejects with
 * `OTP poll timeout after Nms` while the pipeline is still mid-budget,
 * masquerading as a Phase regression even though the pipeline would
 * have accepted a code arriving in the [test_default, pipeline_default]
 * window.
 *
 * Captured 2026-05-07 Beinleumi run `07-05-2026_22113653`:
 * - pipeline reached `otp-fill.ACTION` at 22:15:25
 * - pipeline log emitted `>>> OTP challenge: ... Waiting 180000ms`
 * - test poller cut off at 22:17:25 (start + 120 000 ms)
 * - OTP file mtime 22:17:43 — 17.85 s past the test cutoff but
 *   ~2.3 min within the pipeline's 180 s budget.
 *
 * The fix is to align the test poller default to the pipeline default
 * so the pipeline (which owns the user-facing OTP UX semantics) is the
 * single source of truth for the OTP wait budget. This regression test
 * fails the build before the alignment lands and stays green after.
 */

import { DEFAULT_OTP_TIMEOUT_MS } from '../../../../Scrapers/Pipeline/Mediator/OtpFill/OtpFillPhaseActions.js';
import { DEFAULT_POLL_TIMEOUT_MS } from '../../../E2eReal/OtpPoller.js';

describe('CrossValidation — OtpPoller vs Pipeline OTP watchdog timeout alignment', () => {
  it('test poller default >= pipeline OTP watchdog default (no test-side pre-emption)', () => {
    expect(DEFAULT_POLL_TIMEOUT_MS).toBeGreaterThanOrEqual(DEFAULT_OTP_TIMEOUT_MS);
  });
});
