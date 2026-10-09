/**
 * Unit tests for the Mizrahi pipeline factory.
 * Pins the no-OTP username + password login config and the hard-model
 * chain: BIND-API-MEDIATOR + API-DIRECT-SCRAPE replace the generic
 * post-login discovery phases.
 */

import {
  buildMizrahiPipeline,
  MIZRAHI_LOGIN,
} from '../../../../../Scrapers/Pipeline/Banks/Mizrahi/MizrahiPipeline.js';
import { assertOk } from '../../../../Helpers/AssertProcedure.js';
import { makeMockOptions } from '../../Infrastructure/MockFactories.js';

/** Browser login + hard-model scrape — no OTP, no generic discovery. */
const HARD_MODEL_PHASES = [
  'init',
  'home',
  'login',
  'auth-discovery',
  'bind-api-mediator',
  'api-direct-scrape',
  'terminate',
] as const;

describe('buildMizrahiPipeline', () => {
  it('returns a success Procedure that preserves the options', () => {
    const opts = makeMockOptions();
    const result = buildMizrahiPipeline(opts);
    assertOk(result);
    expect(result.value.options).toBe(opts);
  });

  it('is a browser pipeline (not headless)', () => {
    const opts = makeMockOptions();
    const result = buildMizrahiPipeline(opts);
    assertOk(result);
    expect(result.value.isHeadless).toBe(false);
  });

  it('runs the hard-model chain with no OTP phase', () => {
    const opts = makeMockOptions();
    const result = buildMizrahiPipeline(opts);
    assertOk(result);
    const names = result.value.phases.map((p): string => p.name);
    expect(names).toEqual(HARD_MODEL_PHASES);
  });
});

describe('MIZRAHI_LOGIN', () => {
  it('declares exactly username + password with WellKnown-resolved selectors', () => {
    const keys = MIZRAHI_LOGIN.fields.map((f): string => f.credentialKey);
    expect(keys).toEqual(['username', 'password']);
    const selectorCounts = MIZRAHI_LOGIN.fields.map((f): number => f.selectors.length);
    expect(selectorCounts).toEqual([0, 0]);
    expect(MIZRAHI_LOGIN.submit).toEqual([]);
  });
});
