/**
 * Unit tests for Discount login config and pipeline builder.
 * Tests DISCOUNT_LOGIN minimal shape and buildDiscountPipeline phases.
 */

import { CompanyTypes } from '../../../../../../Definitions.js';
import {
  buildDiscountPipeline,
  DISCOUNT_LOGIN,
} from '../../../../../../Scrapers/Pipeline/Banks/Discount/DiscountPipeline.js';
import { assertOk } from '../../../../../Helpers/AssertProcedure.js';
import { makeMockOptions } from '../../../../Pipeline/Infrastructure/MockFactories.js';

/** Mock options for pipeline builder. */
const MOCK_OPTIONS = makeMockOptions({ companyId: CompanyTypes.Discount });

describe('DISCOUNT_LOGIN', () => {
  describe('config shape', () => {
    it('has three credential fields: id, password, num', () => {
      expect(DISCOUNT_LOGIN.fields).toHaveLength(3);
      const keys = DISCOUNT_LOGIN.fields.map(f => f.credentialKey);
      expect(keys).toEqual(['id', 'password', 'num']);
    });

    it('has empty submit (generic mediator resolves submit)', () => {
      const submit = Array.isArray(DISCOUNT_LOGIN.submit)
        ? DISCOUNT_LOGIN.submit
        : [DISCOUNT_LOGIN.submit];
      expect(submit.length).toBe(0);
    });
  });

  describe('generic flow — no bank-specific callbacks', () => {
    it('has no checkReadiness (HOME phase handles it)', () => {
      expect(DISCOUNT_LOGIN.checkReadiness).toBeUndefined();
    });

    it('has no postAction (DASHBOARD phase handles it)', () => {
      expect(DISCOUNT_LOGIN.postAction).toBeUndefined();
    });

    it('has no preAction (HOME phase handles it)', () => {
      expect(DISCOUNT_LOGIN.preAction).toBeUndefined();
    });
  });
});

describe('buildDiscountPipeline', () => {
  it('returns descriptor with 7 phases', () => {
    const result = buildDiscountPipeline(MOCK_OPTIONS);
    assertOk(result);
    const descriptor = result.value;
    expect(descriptor.phases).toHaveLength(7);
  });

  it('phase names are init, home, find-login-area, login, dashboard, scrape, terminate', () => {
    const result = buildDiscountPipeline(MOCK_OPTIONS);
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
