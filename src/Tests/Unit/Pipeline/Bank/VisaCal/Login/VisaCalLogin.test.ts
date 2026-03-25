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

  describe('lifecycle hooks — connect-iframe login flow', () => {
    it('has checkReadiness (waits for login link before filling fields)', () => {
      expect(VISACAL_LOGIN.checkReadiness).toBeDefined();
    });

    it('has preAction (opens Connect iframe so fields are visible)', () => {
      expect(VISACAL_LOGIN.preAction).toBeDefined();
    });

    it('has postAction (waits for SPA navigation after login)', () => {
      expect(VISACAL_LOGIN.postAction).toBeDefined();
    });
  });
});

describe('buildVisaCalPipeline', () => {
  it('returns descriptor with 6 phases', () => {
    const result = buildVisaCalPipeline(MOCK_OPTIONS);
    assertOk(result);
    const descriptor = result.value;
    expect(descriptor.phases).toHaveLength(6);
  });

  it('phase names are init, home, login, dashboard, scrape, terminate', () => {
    const result = buildVisaCalPipeline(MOCK_OPTIONS);
    assertOk(result);
    const descriptor = result.value;
    const names = descriptor.phases.map(p => p.name);
    expect(names).toEqual(['init', 'home', 'login', 'dashboard', 'scrape', 'terminate']);
  });
});
