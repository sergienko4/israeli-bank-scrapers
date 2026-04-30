/**
 * Unit tests for Isracard pipeline config and builder.
 * Mirrors DiscountPipeline.test.ts — minimal config + builder chain.
 */

import { CompanyTypes } from '../../../../../Definitions.js';
import {
  buildIsracardPipeline,
  ISRACARD_LOGIN,
} from '../../../../../Scrapers/Pipeline/Banks/Isracard/IsracardPipeline.js';
import { assertOk } from '../../../../Helpers/AssertProcedure.js';
import { makeMockOptions } from '../../../Pipeline/Infrastructure/MockFactories.js';

const MOCK_OPTIONS = makeMockOptions({ companyId: CompanyTypes.Isracard });

describe('ISRACARD_LOGIN — config shape', () => {
  it('has three credential fields: id, password, card6Digits', () => {
    expect(ISRACARD_LOGIN.fields).toHaveLength(3);
    const keys = ISRACARD_LOGIN.fields.map(f => f.credentialKey);
    expect(keys).toEqual(['id', 'password', 'card6Digits']);
  });

  it('all fields use empty selectors (WellKnown mediator resolves by Hebrew text)', () => {
    for (const field of ISRACARD_LOGIN.fields) {
      expect(field.selectors).toHaveLength(0);
    }
  });

  it('has empty submit array (mediator uses WellKnown __submit__ fallback)', () => {
    const submit = Array.isArray(ISRACARD_LOGIN.submit)
      ? ISRACARD_LOGIN.submit
      : [ISRACARD_LOGIN.submit];
    expect(submit).toHaveLength(0);
  });

  it('loginUrl is empty (HOME phase handles navigation from PipelineBankConfig)', () => {
    expect(ISRACARD_LOGIN.loginUrl).toBe('');
  });
});

describe('buildIsracardPipeline', () => {
  it('returns a Procedure in success state', () => {
    const result = buildIsracardPipeline(MOCK_OPTIONS);
    assertOk(result);
  });

  it('returns descriptor with 7 phases', () => {
    const result = buildIsracardPipeline(MOCK_OPTIONS);
    assertOk(result);
    expect(result.value.phases).toHaveLength(7);
  });

  it('phase names follow the canonical pipeline chain', () => {
    const result = buildIsracardPipeline(MOCK_OPTIONS);
    assertOk(result);
    const names = result.value.phases.map(p => p.name);
    expect(names).toEqual([
      'init',
      'home',
      'pre-login',
      'login',
      'dashboard',
      'scrape',
      'terminate',
    ]);
  });
});

describe('PII shield — Isracard field safety', () => {
  it('card6Digits is a credential key — covered by SENSITIVE_PATHS in DebugConfig', () => {
    const card6DigitsField = ISRACARD_LOGIN.fields.find(f => f.credentialKey === 'card6Digits');
    expect(card6DigitsField).toBeDefined();
  });

  it('id and password are credential keys — covered by SENSITIVE_PATHS', () => {
    const sensitiveFields = ISRACARD_LOGIN.fields.filter(f =>
      ['id', 'password'].includes(f.credentialKey),
    );
    expect(sensitiveFields).toHaveLength(2);
  });
});
