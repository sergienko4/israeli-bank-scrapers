/**
 * Unit tests for VisaCal login config and pipeline builder.
 * Tests VISACAL_LOGIN shape (minimal config) and buildVisaCalPipeline phases.
 */

import { CompanyTypes } from '../../../../../../Definitions.js';
import {
  buildVisaCalPipeline,
  VISACAL_LOGIN,
} from '../../../../../../Scrapers/Pipeline/Banks/VisaCal/VisaCalPipeline.js';
import { assertOk } from '../../../../../Helpers/AssertProcedure.js';
import { makeMockOptions } from '../../../../Pipeline/Infrastructure/MockFactories.js';

/** Mock options for pipeline builder. */
const MOCK_OPTIONS = makeMockOptions({ companyId: CompanyTypes.VisaCal });

describe('VISACAL_LOGIN', () => {
  describe('config shape', () => {
    it('has username and password fields', () => {
      expect(VISACAL_LOGIN.fields).toHaveLength(2);
      const keys = VISACAL_LOGIN.fields.map(f => f.credentialKey);
      expect(keys).toEqual(['username', 'password']);
    });

    it('has empty submit (generic mediator resolves submit)', () => {
      const submit = Array.isArray(VISACAL_LOGIN.submit)
        ? VISACAL_LOGIN.submit
        : [VISACAL_LOGIN.submit];
      expect(submit.length).toBe(0);
    });
  });

  describe('lifecycle hooks — reused from legacy VisaCal config', () => {
    it('has checkReadiness (reused from VISACAL_LOGIN_CONFIG)', () => {
      expect(VISACAL_LOGIN.checkReadiness).toBeDefined();
    });

    it('has postAction (reused from VISACAL_LOGIN_CONFIG)', () => {
      expect(VISACAL_LOGIN.postAction).toBeDefined();
    });

    it('has preAction (reused from VISACAL_LOGIN_CONFIG)', () => {
      expect(VISACAL_LOGIN.preAction).toBeDefined();
    });
  });
});

describe('buildVisaCalPipeline', () => {
  it('returns descriptor with 7 phases', () => {
    const result = buildVisaCalPipeline(MOCK_OPTIONS);
    assertOk(result);
    const descriptor = result.value;
    expect(descriptor.phases).toHaveLength(7);
  });

  it('phase names are init, home, find-login-area, login, dashboard, scrape, terminate', () => {
    const result = buildVisaCalPipeline(MOCK_OPTIONS);
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
