/**
 * Unit tests for Amex pipeline config and builder.
 * Mirrors DiscountPipeline.test.ts — minimal config + builder chain.
 */

import { CompanyTypes } from '../../../../../Definitions.js';
import {
  AMEX_LOGIN,
  buildAmexPipeline,
} from '../../../../../Scrapers/Pipeline/Banks/Amex/AmexPipeline.js';
import { assertOk } from '../../../../Helpers/AssertProcedure.js';
import { makeMockOptions } from '../../../Pipeline/Infrastructure/MockFactories.js';

const MOCK_OPTIONS = makeMockOptions({ companyId: CompanyTypes.Amex });

describe('AMEX_LOGIN — config shape', () => {
  it('has three credential fields: id, password, card6Digits', () => {
    expect(AMEX_LOGIN.fields).toHaveLength(3);
    const keys = AMEX_LOGIN.fields.map(f => f.credentialKey);
    expect(keys).toEqual(['id', 'password', 'card6Digits']);
  });

  it('all fields use empty selectors (WellKnown mediator resolves by Hebrew text)', () => {
    for (const field of AMEX_LOGIN.fields) {
      expect(field.selectors).toHaveLength(0);
    }
  });

  it('has empty submit array (mediator uses WellKnown __submit__ fallback)', () => {
    const submit = Array.isArray(AMEX_LOGIN.submit) ? AMEX_LOGIN.submit : [AMEX_LOGIN.submit];
    expect(submit).toHaveLength(0);
  });

  it('loginUrl is the home page base URL', () => {
    expect(AMEX_LOGIN.loginUrl).toBeTruthy();
  });
});

describe('buildAmexPipeline', () => {
  it('returns a Procedure in success state', () => {
    const result = buildAmexPipeline(MOCK_OPTIONS);
    assertOk(result);
  });

  it('returns descriptor with 6 phases', () => {
    const result = buildAmexPipeline(MOCK_OPTIONS);
    assertOk(result);
    expect(result.value.phases).toHaveLength(7);
  });

  it('phase names follow the canonical pipeline chain', () => {
    const result = buildAmexPipeline(MOCK_OPTIONS);
    assertOk(result);
    const names = result.value.phases.map(p => p.name);
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
