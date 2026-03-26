/**
 * Unit tests for Amex pipeline config and builder.
 *
 * LIFECYCLE EXPECTATIONS (mirrors AmexPipeline.ts design):
 *   checkReadiness → amexCheckReadiness  (waits for form fields — SPA safe)
 *   preAction      → undefined           (no Connect iframe; form is on-page directly)
 *   postAction     → amexPostLogin       (URL-change guard, not networkidle)
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

// ── Config shape ──────────────────────────────────────────

describe('AMEX_LOGIN — config shape', () => {
  it('has three credential fields: id, password, card6Digits', () => {
    expect(AMEX_LOGIN.fields).toHaveLength(3);
    const keys = AMEX_LOGIN.fields.map(f => f.credentialKey);
    expect(keys).toEqual(['id', 'password', 'card6Digits']);
  });

  it('all fields use empty selectors (WellKnown mediator handles resolution)', () => {
    for (const field of AMEX_LOGIN.fields) {
      expect(field.selectors).toHaveLength(0);
    }
  });

  it('has empty submit array (mediator uses WellKnown __submit__ fallback)', () => {
    const submit = Array.isArray(AMEX_LOGIN.submit) ? AMEX_LOGIN.submit : [AMEX_LOGIN.submit];
    expect(submit).toHaveLength(0);
  });

  it('loginUrl is the home page base URL (Home phase navigates to login from there)', () => {
    expect(AMEX_LOGIN.loginUrl).toBeTruthy();
  });
});

// ── Lifecycle hooks ───────────────────────────────────────

describe('AMEX_LOGIN — lifecycle hooks', () => {
  it('has checkReadiness (waits for WellKnown form fields to appear)', () => {
    expect(AMEX_LOGIN.checkReadiness).toBeDefined();
  });

  it('has NO preAction (no Connect iframe; form is directly on the page)', () => {
    expect(AMEX_LOGIN.preAction).toBeUndefined();
  });

  it('has postAction (URL-change guard after login, avoids networkidle false-timeout)', () => {
    expect(AMEX_LOGIN.postAction).toBeDefined();
  });
});

// ── Builder chain ─────────────────────────────────────────

describe('buildAmexPipeline', () => {
  it('returns a Procedure in success state', () => {
    const result = buildAmexPipeline(MOCK_OPTIONS);
    assertOk(result);
  });

  it('returns descriptor with 6 phases', () => {
    const result = buildAmexPipeline(MOCK_OPTIONS);
    assertOk(result);
    expect(result.value.phases).toHaveLength(6);
  });

  it('phase names follow the canonical pipeline chain', () => {
    const result = buildAmexPipeline(MOCK_OPTIONS);
    assertOk(result);
    const names = result.value.phases.map(p => p.name);
    expect(names).toEqual(['init', 'home', 'login', 'dashboard', 'scrape', 'terminate']);
  });
});
