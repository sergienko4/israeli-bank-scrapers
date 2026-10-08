/**
 * Parity between the fixture redactor and the `fixtures-pii` audit gate
 * (`scripts/audit-fixtures-pii.cjs`).
 *
 * The invariant: the gate flags every shape the redactor rewrites, with the
 * rule that mirrors it, and passes the redacted output; it never flags a
 * look-alike the redactor leaves alone. When either side drifts, this suite
 * fails, so the gate can't stay red on text the redactor won't touch, or
 * pass PII the redactor would have caught.
 */

import { auditText } from '../../../../../scripts/audit-fixtures-pii.cjs';
import { type PiiPatternKey, redactPii } from '../../../Integration/Tools/PiiRedactor.js';
import { NEGATIVE_CASES, POSITIVE_CASES } from './PiiBankShapeCases.js';

/** The gate rule that mirrors each redactor rule the positive cases pin. */
const GATE_RULE_FOR: Partial<Record<PiiPatternKey, string>> = {
  base64EmbeddedIp: 'b64-embedded-ip',
  clientIpField: 'client-ip-field',
  radwareSessionUuid: 'radware-session-uuid',
  requestVerificationToken: 'request-verification-token',
  cookieAuthValue: 'cookie-auth',
  jsonTokenField: 'json-token-field',
  jsonActionGuid: 'json-action-guid',
  hebrewLastLoginLabel: 'hebrew-last-login-label',
  jsonLastLoginField: 'json-last-login',
  mizNumericText: 'miz-numeric-text',
  currencyAmountAttr: 'currency-amount-attr',
  mizrahiReferenceCell: 'miz-reference-cell',
  jsonTranslitMoneyNumber: 'json-translit-money',
  jsonTranslitMoneyString: 'json-translit-money',
  jsonMizrahiReference: 'json-mizrahi-reference',
  jsonBranchField: 'json-branch-field',
  branchBeforeRedactedAccount: 'branch-before-redacted-account',
};

/**
 * The gate rules that fail on a text, ignoring INFO placeholder markers.
 *
 * @param text - Fixture-shaped text.
 * @returns Ids of every CRITICAL or HIGH rule that fired.
 */
function failingRules(text: string): string[] {
  const hits = auditText(text).filter(hit => hit.pat.severity !== 'INFO');
  return hits.map(hit => hit.pat.id);
}

describe('fixtures-pii gate parity with PiiRedactor', () => {
  it.each(POSITIVE_CASES)('flags a raw $key shape with its mirror rule', row => {
    const mirror = GATE_RULE_FOR[row.key];
    const fired = failingRules(row.input);
    expect(fired).toContain(mirror);
  });

  it.each(POSITIVE_CASES)('passes the redacted $key shape', row => {
    const redacted = redactPii(row.input);
    const fired = failingRules(redacted);
    expect(fired).toEqual([]);
  });

  it.each(NEGATIVE_CASES)('never flags a $key look-alike', row => {
    const fired = failingRules(row.input);
    expect(fired).toEqual([]);
  });
});
