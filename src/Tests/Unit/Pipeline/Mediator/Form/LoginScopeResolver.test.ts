/**
 * Branch-coverage tests for the pure helpers exported from
 * `Pipeline/Mediator/Form/LoginScopeResolver.ts`. Tests follow the
 * project's "no-nested-call" rule by binding every call to a const first.
 */

import type { IFieldConfig } from '../../../../../Scrapers/Base/Interfaces/Config/FieldConfig.js';
import { passwordFirst } from '../../../../../Scrapers/Pipeline/Mediator/Form/LoginScopeResolver.js';

const USER_FIELD: IFieldConfig = {
  credentialKey: 'username',
  selectors: [],
};
const PASSWORD_FIELD: IFieldConfig = {
  credentialKey: 'password',
  selectors: [],
};
const ID_FIELD: IFieldConfig = {
  credentialKey: 'id',
  selectors: [],
};

/**
 * Project a list of fields to its credentialKey strings for stable
 * order assertions without re-invoking the helper inside expect().
 * @param fields - List of field configs.
 * @returns The credential keys in the same order.
 */
function toKeys(fields: readonly IFieldConfig[]): readonly string[] {
  return fields.map((f): string => f.credentialKey);
}

describe('passwordFirst', () => {
  it('moves the password field to the head when present mid-list', () => {
    const reordered = passwordFirst([USER_FIELD, PASSWORD_FIELD, ID_FIELD]);
    const keys = toKeys(reordered);
    expect(keys).toEqual(['password', 'username', 'id']);
  });

  it('returns the original order when no password field is present', () => {
    const reordered = passwordFirst([USER_FIELD, ID_FIELD]);
    const keys = toKeys(reordered);
    expect(keys).toEqual(['username', 'id']);
  });

  it('returns an empty array unchanged', () => {
    const reordered = passwordFirst([]);
    expect(reordered).toEqual([]);
  });

  it('preserves order when password is already first', () => {
    const reordered = passwordFirst([PASSWORD_FIELD, USER_FIELD]);
    const keys = toKeys(reordered);
    expect(keys).toEqual(['password', 'username']);
  });
});
