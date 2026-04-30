/**
 * Unit tests for GenericBodyTemplate — hydrates JsonValueTemplate
 * nodes against an ITemplateScope. Covers all $literal / $ref /
 * record branches + failure propagation.
 */

import ScraperError from '../../../../../../Scrapers/Base/ScraperError.js';
import type {
  IApiDirectCallConfig,
  JsonValueTemplate,
  RefToken,
} from '../../../../../../Scrapers/Pipeline/Mediator/ApiDirectCall/IApiDirectCallConfig.js';
import { hydrate } from '../../../../../../Scrapers/Pipeline/Mediator/ApiDirectCall/Template/GenericBodyTemplate.js';
import type { ITemplateScope } from '../../../../../../Scrapers/Pipeline/Mediator/ApiDirectCall/Template/RefResolver.js';

/** Reusable synthetic config referenced by config.* tokens. */
const STUB_CONFIG = {
  flow: 'sms-otp',
  steps: [],
  envelope: {},
  probe: {},
  signer: {
    algorithm: 'ECDSA-P256',
    encoding: 'DER',
    headerName: 'Content-Signature',
    schemeTag: 4,
    canonical: {
      parts: ['bodyJson'],
      separator: '%%',
      escapeFrom: '%%',
      escapeTo: String.raw`\%`,
      sortQueryParams: false,
      clientVersion: '9.9.9',
    },
  },
} as unknown as IApiDirectCallConfig;

/**
 * Build a scope with overridable fields.
 * @param overrides - Partial overrides for the default empty scope.
 * @returns Template scope.
 */
function makeScope(overrides: Partial<ITemplateScope> = {}): ITemplateScope {
  return {
    carry: overrides.carry ?? {},
    creds: overrides.creds ?? {},
    config: overrides.config ?? STUB_CONFIG,
    keypair: overrides.keypair,
    fingerprint: overrides.fingerprint,
  };
}

describe('GenericBodyTemplate.hydrate — $literal', () => {
  it('passes a scalar literal through', (): void => {
    const tmpl: JsonValueTemplate = { $literal: 'hello' };
    const scope = makeScope();
    const result = hydrate(tmpl, scope);
    expect(result.success).toBe(true);
    if (!result.success) throw new ScraperError('hydrate should succeed');
    expect(result.value).toBe('hello');
  });

  it('passes an object literal through', (): void => {
    const tmpl: JsonValueTemplate = { $literal: { x: 1, y: 'two' } };
    const scope = makeScope();
    const result = hydrate(tmpl, scope);
    expect(result.success).toBe(true);
    if (!result.success) throw new ScraperError('hydrate should succeed');
    expect(result.value).toEqual({ x: 1, y: 'two' });
  });
});

describe('GenericBodyTemplate.hydrate — $ref carry/creds/config', () => {
  it('resolves $ref carry.<name>', (): void => {
    const carry = { challenge: 'syn-challenge' };
    const tmpl: JsonValueTemplate = { $ref: 'carry.challenge' };
    const scope = makeScope({ carry });
    const result = hydrate(tmpl, scope);
    expect(result.success).toBe(true);
    if (!result.success) throw new ScraperError('hydrate should succeed');
    expect(result.value).toBe('syn-challenge');
  });

  it('resolves $ref creds.password', (): void => {
    const creds = { password: '0000' };
    const tmpl: JsonValueTemplate = { $ref: 'creds.password' };
    const scope = makeScope({ creds });
    const result = hydrate(tmpl, scope);
    expect(result.success).toBe(true);
    if (!result.success) throw new ScraperError('hydrate should succeed');
    expect(result.value).toBe('0000');
  });

  it('resolves $ref config.signer.canonical.clientVersion', (): void => {
    const tmpl: JsonValueTemplate = {
      $ref: 'config.signer.canonical.clientVersion',
    };
    const scope = makeScope();
    const result = hydrate(tmpl, scope);
    expect(result.success).toBe(true);
    if (!result.success) throw new ScraperError('hydrate should succeed');
    expect(result.value).toBe('9.9.9');
  });
});

describe('GenericBodyTemplate.hydrate — $ref uuid', () => {
  it('produces a 36-char UUID string', (): void => {
    const tmpl: JsonValueTemplate = { $ref: 'uuid' };
    const scope = makeScope();
    const result = hydrate(tmpl, scope);
    expect(result.success).toBe(true);
    if (!result.success) throw new ScraperError('hydrate should succeed');
    const v = result.value as string;
    expect(typeof v).toBe('string');
    expect(v.length).toBe(36);
  });
});

describe('GenericBodyTemplate.hydrate — nested records', () => {
  it('recurses through nested record + child $ref + child $literal', (): void => {
    const tmpl: JsonValueTemplate = {
      data: {
        challenge: { $ref: 'carry.challenge' },
        type: { $literal: 'password' },
      },
    };
    const scope = makeScope({ carry: { challenge: 'abc' } });
    const result = hydrate(tmpl, scope);
    expect(result.success).toBe(true);
    if (!result.success) throw new ScraperError('hydrate should succeed');
    expect(result.value).toEqual({
      data: { challenge: 'abc', type: 'password' },
    });
  });
});

describe('GenericBodyTemplate.hydrate — arrays preserved + recursed', () => {
  it('recurses an array with mixed $literal / $ref elements', (): void => {
    const tmpl: JsonValueTemplate = [
      { type: { $literal: 'flow_id' }, flow_id: { $ref: 'carry.flowId' } },
      { type: { $literal: 'uid' }, uid: { $ref: 'creds.phoneNumber' } },
    ] as unknown as JsonValueTemplate;
    const scope = makeScope({ carry: { flowId: 'fid-1' }, creds: { phoneNumber: '+97' } });
    const result = hydrate(tmpl, scope);
    expect(result.success).toBe(true);
    if (!result.success) throw new ScraperError('hydrate should succeed');
    const isArrayResult = Array.isArray(result.value);
    expect(isArrayResult).toBe(true);
    expect(result.value).toEqual([
      { type: 'flow_id', flow_id: 'fid-1' },
      { type: 'uid', uid: '+97' },
    ]);
  });
});

describe('GenericBodyTemplate.hydrate — branch coverage', () => {
  it('hydrates a $literal: null node verbatim', (): void => {
    const scope = makeScope();
    const result = hydrate({ $literal: null } as JsonValueTemplate, scope);
    expect(result.success).toBe(true);
    if (!result.success) throw new ScraperError('null literal should hydrate');
    expect(result.value).toBeNull();
  });

  it('hydrates a nested object literal via coerceJson object branch', (): void => {
    const scope = makeScope();
    const result = hydrate({ $literal: { a: 1, b: [2, 3] } } as JsonValueTemplate, scope);
    expect(result.success).toBe(true);
    if (!result.success) throw new ScraperError('object literal should hydrate');
    expect(result.value).toEqual({ a: 1, b: [2, 3] });
  });

  it('short-circuits absorbEntry when a record entry fails to hydrate', (): void => {
    const scope = makeScope();
    const tmpl: JsonValueTemplate = {
      ok: { $literal: 'ok' },
      bad: { $ref: 'carry.missing' },
    };
    const result = hydrate(tmpl, scope);
    expect(result.success).toBe(false);
    if (!result.success) expect(result.errorMessage).toContain('carry.missing');
  });

  it('short-circuits hydrateArray when an element fails to hydrate', (): void => {
    const scope = makeScope();
    const tmpl = [{ $literal: 'ok' }, { $ref: 'carry.absent' }] as unknown as JsonValueTemplate;
    const result = hydrate(tmpl, scope);
    expect(result.success).toBe(false);
    if (!result.success) expect(result.errorMessage).toContain('carry.absent');
  });
});

describe('GenericBodyTemplate.hydrate — failures', () => {
  it('propagates fail when $ref carry.<missing> is absent', (): void => {
    const tmpl: JsonValueTemplate = { $ref: 'carry.nope' };
    const scope = makeScope();
    const result = hydrate(tmpl, scope);
    expect(result.success).toBe(false);
    if (!result.success) expect(result.errorMessage).toContain('carry.nope');
  });

  it('propagates fail for an unknown $ref token', (): void => {
    const tmpl: JsonValueTemplate = { $ref: 'something.else' as RefToken };
    const scope = makeScope();
    const result = hydrate(tmpl, scope);
    expect(result.success).toBe(false);
    if (!result.success) expect(result.errorMessage).toContain('something.else');
  });

  it('empty record template hydrates to empty object', (): void => {
    const tmpl: JsonValueTemplate = {};
    const scope = makeScope();
    const result = hydrate(tmpl, scope);
    expect(result.success).toBe(true);
    if (!result.success) throw new ScraperError('hydrate should succeed');
    expect(result.value).toEqual({});
  });
});
