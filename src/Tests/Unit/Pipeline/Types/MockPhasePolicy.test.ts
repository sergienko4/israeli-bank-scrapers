/**
 * Unit tests for Types/MockPhasePolicy — per-phase mock short-circuit map.
 */

import { mockPolicyFor } from '../../../../Scrapers/Pipeline/Types/MockPhasePolicy.js';
import type { PhaseName } from '../../../../Scrapers/Pipeline/Types/Phase.js';

describe('mockPolicyFor', () => {
  /** Phases that should only run PRE under MOCK_MODE. */
  const preOnlyPhases: readonly PhaseName[] = [
    'home',
    'pre-login',
    'login',
    'otp-trigger',
    'otp-fill',
    'dashboard',
    'scrape',
  ];

  it.each(preOnlyPhases)('returns pre=false & action/post/final=true for %s', phase => {
    const policy = mockPolicyFor(phase);
    expect(policy.pre).toBe(false);
    expect(policy.action).toBe(true);
    expect(policy.post).toBe(true);
    expect(policy.final).toBe(true);
  });

  it('returns RUN_ALL policy for init', () => {
    const policy = mockPolicyFor('init');
    expect(policy.pre).toBe(false);
    expect(policy.action).toBe(false);
    expect(policy.post).toBe(false);
    expect(policy.final).toBe(false);
  });

  it('returns RUN_ALL policy for terminate', () => {
    const policy = mockPolicyFor('terminate');
    expect(policy.pre).toBe(false);
    expect(policy.action).toBe(false);
    expect(policy.post).toBe(false);
    expect(policy.final).toBe(false);
  });
});
