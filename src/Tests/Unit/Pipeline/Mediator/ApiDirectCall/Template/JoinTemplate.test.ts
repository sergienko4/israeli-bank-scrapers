/**
 * N24 — a `$join` node hydrates to one string: its parts (refs resolved,
 * literals kept) concatenated, base64 over the UTF-8 bytes when `encode` is
 * `base64`, behind `prefix`. A part that is unresolved or not a string fails
 * hydration like a missing `$ref`; the value never reaches carry.
 */

import { ScraperErrorTypes } from '../../../../../../Scrapers/Base/ErrorTypes.js';
import type {
  IApiDirectCallConfig,
  JsonValueTemplate,
} from '../../../../../../Scrapers/Pipeline/Mediator/ApiDirectCall/ConfigContracts/index.js';
import { hydrate } from '../../../../../../Scrapers/Pipeline/Mediator/ApiDirectCall/Template/GenericBodyTemplate.js';
import type { ITemplateScope } from '../../../../../../Scrapers/Pipeline/Mediator/ApiDirectCall/Template/RefResolver.js';

const CREDS = { num: '12', nationalID: '345', password: 'סיסמה' };
/** base64 of the UTF-8 bytes of `12-345:סיסמה`. */
const BASIC_GOLDEN = 'Basic MTItMzQ1Oteh15nXodee15Q=';

/**
 * A scope over the test creds and the given carry.
 * @param carry - Carry slots.
 * @returns Template scope.
 */
function scopeWith(carry: ITemplateScope['carry'] = {}): ITemplateScope {
  return { carry, creds: CREDS, config: {} as IApiDirectCallConfig };
}

const USERNAME: JsonValueTemplate = {
  $join: { parts: ['creds.num', { literal: '-' }, 'creds.nationalID'] },
};

const AUTHORIZATION: JsonValueTemplate = {
  $join: {
    parts: ['creds.num', { literal: '-' }, 'creds.nationalID', { literal: ':' }, 'creds.password'],
    encode: 'base64',
    prefix: 'Basic ',
  },
};

describe('GenericBodyTemplate.hydrate — $join (N24)', () => {
  it('concatenates refs and literals in order', () => {
    const scope = scopeWith();
    const result = hydrate(USERNAME, scope);
    expect(result).toEqual({ success: true, value: '12-345' });
  });

  it('base64-encodes the UTF-8 join behind the prefix, inside a record', () => {
    const carry = { mag: 'm1' };
    const scope = scopeWith(carry);
    const result = hydrate({ authorization: AUTHORIZATION }, scope);
    expect(result).toEqual({ success: true, value: { authorization: BASIC_GOLDEN } });
    expect(scope.carry).toEqual({ mag: 'm1' });
  });

  it('puts the prefix before a plain join', () => {
    const scope = scopeWith();
    const template = { $join: { parts: ['creds.num'], prefix: 'id-' } } as const;
    const result = hydrate(template, scope);
    expect(result).toEqual({ success: true, value: 'id-12' });
  });

  it('fails an unresolved part exactly like a missing $ref', () => {
    const scope = scopeWith();
    const viaRef = hydrate({ $ref: 'carry.absent' }, scope);
    const template = { $join: { parts: [{ literal: 'a' }, 'carry.absent'] } } as const;
    const viaJoin = hydrate(template, scope);
    expect(viaJoin).toEqual(viaRef);
    expect(viaJoin).toMatchObject({ success: false, errorType: ScraperErrorTypes.Generic });
  });

  it('fails a part that resolves to a non-string', () => {
    const scope = scopeWith({ count: 5 });
    const template = { $join: { parts: ['carry.count'] } } as const;
    const result = hydrate(template, scope);
    expect(result).toMatchObject({
      success: false,
      errorType: ScraperErrorTypes.Generic,
      errorMessage: '$join part carry.count is not a string',
    });
  });
});
