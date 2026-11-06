/**
 * Per-bank fixture expectations — STRUCTURAL invariants the captured
 * HTML must satisfy + Mode-B intercept origin. Drives the offline
 * integration tests.
 *
 * <p>Schema is OPEN by design: tests iterate over `steps[]`, banks
 * declare what they need. Adding new banks = new entry, no test code
 * change.
 *
 * <p>`requiresHydration: true` means the captured static HTML alone
 * isn't sufficient to drive LOGIN PRE discovery (SPA — the form is
 * rendered post-JS). Tests for these banks run STRUCTURAL checks
 * only, skipping the production-pipeline drive until asset capture
 * is implemented (follow-up PR).
 */

import type { IBankFixtureExpectations } from './FixtureExpectations.js';

const LEUMI_PHASE_11_STEPS = [
  { stepName: '01-home' },
  { stepName: '04-login-action' },
  { stepName: '07-auth-discovery' },
  { stepName: '08-account-resolve' },
  { stepName: '09-dashboard' },
  { stepName: '10-scrape-transactions' },
  { stepName: '11-balance' },
] as const;

const BANK_FIXTURE_EXPECTATIONS: readonly IBankFixtureExpectations[] = [
  {
    bankId: 'leumi',
    originUrl: 'https://www.leumi.co.il',
    loginStep: '04-login-action',
    requiresHydration: false,
    steps: LEUMI_PHASE_11_STEPS,
  },
];

export default BANK_FIXTURE_EXPECTATIONS;
