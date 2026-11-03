/**
 * A `$merge` node hydrates to the carried flat string record `base`
 * with the hydrated `set` laid over it: a `set` key replaces the base value in
 * place, a new one goes last. A base that is not a flat string record fails
 * naming the token only, and carry is never changed.
 */

import { ScraperErrorTypes } from '../../../../../../Scrapers/Base/ErrorTypes.js';
import type {
  IApiDirectCallConfig,
  JsonValueTemplate,
} from '../../../../../../Scrapers/Pipeline/Mediator/ApiDirectCall/ConfigContracts/index.js';
import type { JsonValue } from '../../../../../../Scrapers/Pipeline/Mediator/ApiDirectCall/Envelope/JsonPointer.js';
import { hydrate } from '../../../../../../Scrapers/Pipeline/Mediator/ApiDirectCall/Template/GenericBodyTemplate.js';
import type { ITemplateScope } from '../../../../../../Scrapers/Pipeline/Mediator/ApiDirectCall/Template/RefResolver.js';

const SECRET = 'secret-value';
const LOGIN_FORM = { user: '', passwordEnc: '', bankId: SECRET };
const NOT_FLAT = '$merge base carry.loginForm not a flat string record';

const MERGE: JsonValueTemplate = {
  $merge: {
    base: 'carry.loginForm',
    set: {
      passwordEnc: { $ref: 'carry.token' },
      user: { $ref: 'creds.username' },
      lang: { $literal: 'he' },
    },
  },
};

const BAD_BASES: readonly (readonly [string, JsonValue])[] = [
  ['a string', SECRET],
  ['an array', [SECRET]],
  ['a nested record', { a: { b: SECRET } }],
  ['a record holding a number', { a: 1, b: SECRET }],
  ['null', null],
];

/**
 * A scope over the test creds and the given carry.
 * @param carry - Carry slots.
 * @returns Template scope.
 */
function scopeWith(carry: ITemplateScope['carry']): ITemplateScope {
  return { carry, creds: { username: 'u1' }, config: {} as IApiDirectCallConfig };
}

describe('GenericBodyTemplate.hydrate — $merge', () => {
  it('lays set over base: a replaced key keeps its place, a new key goes last', () => {
    const scope = scopeWith({ loginForm: LOGIN_FORM, token: 'T' });
    const result = hydrate(MERGE, scope);
    const merged = result.success ? result.value : {};
    const names = Object.keys(merged as object);
    const expected = { user: 'u1', passwordEnc: 'T', bankId: SECRET, lang: 'he' };
    expect(result).toEqual({ success: true, value: expected });
    expect(names).toEqual(['user', 'passwordEnc', 'bankId', 'lang']);
    expect(scope.carry).toEqual({ loginForm: LOGIN_FORM, token: 'T' });
  });

  it('merges inside a record and with an empty set', () => {
    const template = { $merge: { base: 'carry.loginForm', set: {} } } as const;
    const scope = scopeWith({ loginForm: LOGIN_FORM });
    const result = hydrate({ form: template }, scope);
    expect(result).toEqual({ success: true, value: { form: LOGIN_FORM } });
  });

  it.each(BAD_BASES)('refuses a base that is %s, naming no value', (_label, base) => {
    const scope = scopeWith({ loginForm: base, token: 'T' });
    const result = hydrate(MERGE, scope);
    const text = JSON.stringify(result);
    expect(result).toMatchObject({
      success: false,
      errorType: ScraperErrorTypes.Generic,
      errorMessage: NOT_FLAT,
    });
    expect(text).not.toContain(SECRET);
  });

  it('fails a missing base exactly like a missing $ref', () => {
    const scope = scopeWith({ token: 'T' });
    const viaRef = hydrate({ $ref: 'carry.loginForm' }, scope);
    const viaMerge = hydrate(MERGE, scope);
    expect(viaMerge).toEqual(viaRef);
    expect(viaMerge).toMatchObject({ success: false, errorType: ScraperErrorTypes.Generic });
  });

  it('fails a set ref that does not resolve', () => {
    const scope = scopeWith({ loginForm: LOGIN_FORM });
    const viaRef = hydrate({ $ref: 'carry.token' }, scope);
    const viaMerge = hydrate(MERGE, scope);
    expect(viaMerge).toEqual(viaRef);
  });
});
