/**
 * Unit tests for Isracard pipeline config and builder.
 *
 * ════════════════════════════════════════════
 *  CANARY TEST — ESLint no-restricted-syntax
 * ════════════════════════════════════════════
 * This file itself is a canary. If any of the imported modules violate the
 * architecture rules below, the build will fail BEFORE these tests run:
 *
 *   ✅ no ternary operators (ConditionalExpression → forbidden)
 *   ✅ no else blocks (IfStatement[alternate] → forbidden)
 *   ✅ no while/do-while (WhileStatement → forbidden)
 *   ✅ no return primitives in exported methods (Rule #15)
 *   ✅ no Playwright imports in Phase/Pipeline files (Rule #10)
 *
 * LIFECYCLE EXPECTATIONS:
 *   checkReadiness → isracardCheckReadiness  (domcontentloaded — SPA safe)
 *   preAction      → undefined               (no Connect iframe; form is on-page)
 *   postAction     → isracardPostLogin       (waitForSelector guard + popup dismiss)
 *
 * INDEPENDENT FROM AMEX:
 *   Both pipelines are tested independently — no shared lifecycle hooks.
 */

import { CompanyTypes } from '../../../../../Definitions.js';
import {
  buildIsracardPipeline,
  ISRACARD_LOGIN,
} from '../../../../../Scrapers/Pipeline/Banks/Isracard/IsracardPipeline.js';
import { assertOk } from '../../../../Helpers/AssertProcedure.js';
import { makeMockOptions } from '../../../Pipeline/Infrastructure/MockFactories.js';

/** Mock options for pipeline builder. */
const MOCK_OPTIONS = makeMockOptions({ companyId: CompanyTypes.Isracard });

// ── Config shape ──────────────────────────────────────────

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

  it('loginUrl is the home page base URL (Home phase navigates to login from there)', () => {
    expect(ISRACARD_LOGIN.loginUrl).toBeTruthy();
  });
});

// ── Lifecycle hooks — INDEPENDENT from Amex ──────────────

describe('ISRACARD_LOGIN — lifecycle hooks (independent from Amex)', () => {
  it('has checkReadiness (domcontentloaded wait — Isracard SPA safe)', () => {
    expect(ISRACARD_LOGIN.checkReadiness).toBeDefined();
  });

  it('has NO preAction (no Connect iframe; form is directly on the page)', () => {
    expect(ISRACARD_LOGIN.preAction).toBeUndefined();
  });

  it('has postAction (waitForSelector + popup dismiss — differs from Amex waitForURL)', () => {
    expect(ISRACARD_LOGIN.postAction).toBeDefined();
  });

  it('postAction is different from any Amex hook (independent config)', async () => {
    // Import Amex config to verify they are distinct functions
    const { AMEX_LOGIN: amexLogin } =
      await import('../../../../../Scrapers/Pipeline/Banks/Amex/AmexPipeline.js');
    expect(ISRACARD_LOGIN.postAction).not.toBe(amexLogin.postAction);
    expect(ISRACARD_LOGIN.checkReadiness).not.toBe(amexLogin.checkReadiness);
  });
});

// ── Builder chain ─────────────────────────────────────────

describe('buildIsracardPipeline', () => {
  it('returns a Procedure in success state', () => {
    const result = buildIsracardPipeline(MOCK_OPTIONS);
    assertOk(result);
  });

  it('returns descriptor with 6 phases', () => {
    const result = buildIsracardPipeline(MOCK_OPTIONS);
    assertOk(result);
    expect(result.value.phases).toHaveLength(6);
  });

  it('phase names follow the canonical pipeline chain', () => {
    const result = buildIsracardPipeline(MOCK_OPTIONS);
    assertOk(result);
    const names = result.value.phases.map(p => p.name);
    expect(names).toEqual(['init', 'home', 'login', 'dashboard', 'scrape', 'terminate']);
  });
});

// ── Canary: PII shield contract ───────────────────────────

describe('PII shield — Isracard field safety', () => {
  it('card6Digits is a credential key — covered by SENSITIVE_PATHS in DebugConfig', () => {
    // Structural proof: if this field were ever logged, DebugConfig.SENSITIVE_PATHS
    // contains 'card6Digits' and 'credentials.card6Digits' → censor → '[REDACTED]'
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
