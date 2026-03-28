/**
 * Unit tests for Amex pipeline config and builder.
 * Tests AMEX_LOGIN minimal shape and buildAmexPipeline phases.
 */

import { CompanyTypes } from '../../../../../Definitions.js';
import {
  AMEX_LOGIN,
  buildAmexPipeline,
} from '../../../../../Scrapers/Pipeline/Banks/Amex/AmexPipeline.js';
import { assertOk } from '../../../../Helpers/AssertProcedure.js';
import { makeMockOptions } from '../../../Pipeline/Infrastructure/MockFactories.js';

/** Mock options for pipeline builder. */
const MOCK_OPTIONS = makeMockOptions({ companyId: CompanyTypes.Amex });

describe('AMEX_LOGIN', () => {
  describe('config shape', () => {
    it('has three credential fields: id, password, card6Digits', () => {
      expect(AMEX_LOGIN.fields).toHaveLength(3);
      const keys = AMEX_LOGIN.fields.map(f => f.credentialKey);
      expect(keys).toEqual(['id', 'password', 'card6Digits']);
    });

    it('has empty submit (generic mediator resolves submit)', () => {
      const submit = Array.isArray(AMEX_LOGIN.submit) ? AMEX_LOGIN.submit : [AMEX_LOGIN.submit];
      expect(submit.length).toBe(0);
    });
  });

  describe('generic flow — no bank-specific callbacks', () => {
    it('has no checkReadiness (HOME phase handles it)', () => {
      expect(AMEX_LOGIN.checkReadiness).toBeUndefined();
    });

    it('has no postAction (DASHBOARD phase handles it)', () => {
      expect(AMEX_LOGIN.postAction).toBeUndefined();
    });

    it('has no preAction (HOME phase handles it)', () => {
      expect(AMEX_LOGIN.preAction).toBeUndefined();
    });
  });
});

describe('buildAmexPipeline', () => {
  it('returns descriptor with 7 phases', () => {
    const result = buildAmexPipeline(MOCK_OPTIONS);
    assertOk(result);
    const descriptor = result.value;
    expect(descriptor.phases).toHaveLength(7);
  });

  it('phase names are init, home, find-login-area, login, dashboard, scrape, terminate', () => {
    const result = buildAmexPipeline(MOCK_OPTIONS);
    assertOk(result);
    const descriptor = result.value;
    const names = descriptor.phases.map(p => p.name);
    expect(names).toEqual([
      'init',
      'home',
      'find-login-area',
      'login',
      'dashboard',
      'scrape',
      'terminate',
    ]);
  });
});
