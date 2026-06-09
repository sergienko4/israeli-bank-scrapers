/**
 * Unit tests for the canonical 11-phase enum + Option-based parse + ordinal helpers.
 */

import { isSome } from '../../../../Scrapers/Pipeline/Types/Option.js';
import {
  asIntegrationPhase,
  INTEGRATION_PHASES,
  isForwardTransition,
  phaseOrdinal,
} from '../../../Integration/Phases/IntegrationPhase.js';

describe('INTEGRATION_PHASES', () => {
  it('contains exactly 11 phases in canonical PHASE_CHAIN order', () => {
    const expected = [
      'INIT',
      'HOME',
      'PRE_LOGIN',
      'LOGIN',
      'OTP_TRIGGER',
      'OTP_FILL',
      'AUTH_DISCOVERY',
      'ACCOUNT_RESOLVE',
      'DASHBOARD',
      'SCRAPE',
      'TERMINATE',
    ];
    expect(INTEGRATION_PHASES).toEqual(expected);
  });
});

describe('asIntegrationPhase', () => {
  it('returns Some for every canonical phase string', () => {
    for (const phase of INTEGRATION_PHASES) {
      const result = asIntegrationPhase(phase);
      const isMatched = isSome(result);
      expect(isMatched).toBe(true);
      if (isSome(result)) expect(result.value).toBe(phase);
    }
  });

  it('returns None for unknown phase strings', () => {
    const empty = asIntegrationPhase('');
    const lower = asIntegrationPhase('init');
    const unknown = asIntegrationPhase('UNKNOWN');
    const stale = asIntegrationPhase('LOGIN_PRE');
    const isEmptyMatched = isSome(empty);
    const isLowerMatched = isSome(lower);
    const isUnknownMatched = isSome(unknown);
    const isStaleMatched = isSome(stale);
    expect(isEmptyMatched).toBe(false);
    expect(isLowerMatched).toBe(false);
    expect(isUnknownMatched).toBe(false);
    expect(isStaleMatched).toBe(false);
  });
});

describe('phaseOrdinal', () => {
  it('returns 0 for INIT and 10 for TERMINATE', () => {
    const initOrdinal = phaseOrdinal('INIT');
    const terminateOrdinal = phaseOrdinal('TERMINATE');
    expect(initOrdinal).toBe(0);
    expect(terminateOrdinal).toBe(10);
  });

  it('matches the array index for every phase', () => {
    for (let i = 0; i < INTEGRATION_PHASES.length; i += 1) {
      const phase = INTEGRATION_PHASES[i];
      const ordinal = phaseOrdinal(phase);
      expect(ordinal).toBe(i);
    }
  });
});

describe('isForwardTransition', () => {
  it('accepts strictly forward transitions', () => {
    const isInitToHomeForward = isForwardTransition('INIT', 'HOME');
    const isLoginToOtpForward = isForwardTransition('LOGIN', 'OTP_TRIGGER');
    const isDashboardToTerminateForward = isForwardTransition('DASHBOARD', 'TERMINATE');
    expect(isInitToHomeForward).toBe(true);
    expect(isLoginToOtpForward).toBe(true);
    expect(isDashboardToTerminateForward).toBe(true);
  });

  it('rejects same-phase transitions', () => {
    const isSameLoginForward = isForwardTransition('LOGIN', 'LOGIN');
    expect(isSameLoginForward).toBe(false);
  });

  it('rejects backward transitions', () => {
    const isTermToInitForward = isForwardTransition('TERMINATE', 'INIT');
    const isDashboardToLoginForward = isForwardTransition('DASHBOARD', 'LOGIN');
    expect(isTermToInitForward).toBe(false);
    expect(isDashboardToLoginForward).toBe(false);
  });
});
