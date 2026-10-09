/**
 * Explicit-success veto for the auth-API body classifier.
 *
 * Mizrahi's LoginUser reuses Max's field names with other values: a
 * real success is { ReturnCode: 1, LoginStatus: 1, Success: true }. A
 * declared success must outrank the codes the failure rows infer,
 * without changing any failure row (Max keeps its contract).
 */

import {
  AUTH_BODY_FAILURE_PATTERNS,
  classifyBodyAsFailure,
} from '../../../../../Scrapers/Pipeline/Mediator/Network/AuthFailureWatcher/index.js';
import { AUTH_BODY_SUCCESS_MARKERS } from '../../../../../Scrapers/Pipeline/Mediator/Network/AuthFailureWatcher/Patterns.js';
import type { JsonUnknown } from '../../../../../Scrapers/Pipeline/Types/JsonValue.js';

/** Mizrahi LoginUser success shape (keys and codes from a real capture; no PII). */
const MIZRAHI_SUCCESS: Record<string, JsonUnknown> = {
  ReturnCode: 1,
  LoginStatus: 1,
  ReturnMessagesKey: 'LoginOK',
  Jwt: null,
  Success: true,
  Message: null,
};

/** Mizrahi LoginUser rejection shape (wrong or malformed credentials). */
const MIZRAHI_FAILURE: Record<string, JsonUnknown> = {
  ReturnCode: 9,
  LoginStatus: 9,
  ReturnMessagesKey: 'IllegalCharacters',
  Success: false,
  Message: null,
};

/** Oracle sample table: one failing value per failure-pattern field. */
const FAILING_SAMPLE: Record<string, JsonUnknown> = {
  LoginStatus: -1,
  ReturnCode: 99,
  error_code: -1,
  error: 'bad',
  Status: 'FAILED',
};

/** Failure-pattern fields, in table order. */
const FAILURE_FIELDS = AUTH_BODY_FAILURE_PATTERNS.map((pattern): string => pattern.field);

/**
 * Build a body carrying one failure field plus an optional Success flag.
 * @param field - Failure-pattern field under test.
 * @param success - Success flag to add, or the string 'absent' for none.
 * @returns Parsed-JSON-shaped body.
 */
function bodyWith(field: string, success: boolean | 'absent'): Record<string, JsonUnknown> {
  const body: Record<string, JsonUnknown> = { [field]: FAILING_SAMPLE[field] };
  if (success !== 'absent') body.Success = success;
  return body;
}

/**
 * Classify a body carrying one failure field plus an optional Success flag.
 * @param field - Failure-pattern field under test.
 * @param success - Success flag to add, or the string 'absent' for none.
 * @returns The classifier verdict (pattern note or false).
 */
function verdictFor(field: string, success: boolean | 'absent'): string | false {
  const body = bodyWith(field, success);
  return classifyBodyAsFailure(body);
}

describe('AuthFailureWatcher — explicit-success veto', () => {
  it('classifies the Mizrahi LoginUser success body as not a failure', () => {
    const verdict = classifyBodyAsFailure(MIZRAHI_SUCCESS);
    expect(verdict).toBe(false);
  });

  it('still classifies the Mizrahi LoginUser rejection body as a failure', () => {
    const verdict = classifyBodyAsFailure(MIZRAHI_FAILURE);
    expect(verdict).toMatch(/LoginStatus/);
  });

  it('has exactly one oracle sample per failure-pattern row', () => {
    const sampled = Object.keys(FAILING_SAMPLE).sort();
    const fields = [...FAILURE_FIELDS].sort();
    expect(sampled).toEqual(fields);
  });

  it.each(FAILURE_FIELDS)('Success: true vetoes the %s row; false or absent does not', field => {
    const vetoed = verdictFor(field, true);
    const declaredFalse = verdictFor(field, false);
    const undeclared = verdictFor(field, 'absent');
    expect(vetoed).toBe(false);
    expect(typeof declaredFalse).toBe('string');
    expect(typeof undeclared).toBe('string');
  });

  it('only the JSON boolean true declares success', () => {
    const stringFlag = classifyBodyAsFailure({ LoginStatus: -1, Success: 'true' });
    const numberFlag = classifyBodyAsFailure({ LoginStatus: -1, Success: 1 });
    expect(stringFlag).toMatch(/Max/);
    expect(numberFlag).toMatch(/Max/);
  });

  it('a top-level success declaration does not hide a nested rejection', () => {
    const verdict = classifyBodyAsFailure({ Success: true, Login: { Status: 'FAILED' } });
    expect(verdict).toMatch(/Discount/);
  });

  it('a nested success declaration vetoes only its own record', () => {
    const body = { Result: { LoginStatus: 1, Success: true }, Login: { Status: 'FAILED' } };
    const verdict = classifyBodyAsFailure(body);
    expect(verdict).toMatch(/Discount/);
  });

  it('keeps success-marker fields disjoint from failure-pattern fields', () => {
    const markerFields = AUTH_BODY_SUCCESS_MARKERS.map((marker): string => marker.field);
    const overlap = markerFields.filter((field): boolean => FAILURE_FIELDS.includes(field));
    expect(overlap).toEqual([]);
  });
});
