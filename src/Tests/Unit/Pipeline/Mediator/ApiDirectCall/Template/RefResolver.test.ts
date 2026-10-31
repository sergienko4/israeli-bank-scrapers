/**
 * Unit tests for RefResolver.resolveRef — covers all 6 token families:
 * fingerprint, uuid, now/nowMs, keypair.{ec|rsa}.publicKeyBase64,
 * carry.<name>, creds.<field>, config.<dotted.path>.
 */

import ScraperError from '../../../../../../Scrapers/Base/ScraperError.js';
import type {
  IApiDirectCallConfig,
  RefToken,
} from '../../../../../../Scrapers/Pipeline/Mediator/ApiDirectCall/ConfigContracts/index.js';
import type { IGenericKeypair } from '../../../../../../Scrapers/Pipeline/Mediator/ApiDirectCall/Crypto/CryptoKeyFactory.js';
import { generateKeypair } from '../../../../../../Scrapers/Pipeline/Mediator/ApiDirectCall/Crypto/CryptoKeyFactory.js';
import type { CookieLookup } from '../../../../../../Scrapers/Pipeline/Mediator/ApiDirectCall/Template/CookieRef.js';
import {
  type ITemplateScope,
  resolveRef,
} from '../../../../../../Scrapers/Pipeline/Mediator/ApiDirectCall/Template/RefResolver.js';
import { none, type Option, some } from '../../../../../../Scrapers/Pipeline/Types/Option.js';

const CONFIG_STUB = {
  flow: 'sms-otp',
  steps: [],
  envelope: {},
  probe: { queryTag: 'customer' },
  signer: {
    canonical: { clientVersion: '9.9.9' },
  },
} as unknown as IApiDirectCallConfig;

/**
 * Build a scope with optional overrides.
 * @param overrides - Fields to merge.
 * @returns Template scope.
 */
function makeScope(overrides: Partial<ITemplateScope> = {}): ITemplateScope {
  return {
    carry: overrides.carry ?? {},
    creds: overrides.creds ?? {},
    config: overrides.config ?? CONFIG_STUB,
    keypair: overrides.keypair,
    fingerprint: overrides.fingerprint,
    cookie: overrides.cookie,
  };
}

/**
 * Generate a real ECDSA keypair for keypair.* handler tests.
 * @returns IGenericKeypair.
 */
function makeTestKeypair(): IGenericKeypair {
  const proc = generateKeypair('ECDSA-P256');
  if (!proc.success) throw new ScraperError('keypair gen failed');
  return proc.value;
}

/**
 * Non-JSON creds entry used by the coerceToJsonValue failure test.
 * Returns an empty string; only its typeof='function' matters.
 * @returns Empty string.
 */
function nonSerializableFn(): string {
  return '';
}

/** Typed alias of the function — cred slot accepts `unknown`. */
const NON_SERIALIZABLE_FN: unknown = nonSerializableFn;

describe('RefResolver.resolveRef fingerprint', () => {
  it('returns scope.fingerprint when present', (): void => {
    const scope = makeScope({ fingerprint: { metadata: { ts: 1 } } });
    const result = resolveRef('fingerprint', scope);
    expect(result.success).toBe(true);
    if (!result.success) throw new ScraperError('fingerprint should resolve');
    expect(result.value).toEqual({ metadata: { ts: 1 } });
  });

  it('fails when scope.fingerprint is absent', (): void => {
    const scope = makeScope();
    const result = resolveRef('fingerprint', scope);
    expect(result.success).toBe(false);
    if (!result.success) expect(result.errorMessage).toContain('scope.fingerprint is absent');
  });
});

describe('RefResolver.resolveRef time + uuid', () => {
  it('returns a 36-char UUID string for uuid', (): void => {
    const scope = makeScope();
    const result = resolveRef('uuid', scope);
    expect(result.success).toBe(true);
    if (!result.success) throw new ScraperError('uuid should resolve');
    const v = result.value as string;
    expect(v).toHaveLength(36);
  });

  it('returns a unix-seconds number for now', (): void => {
    const scope = makeScope();
    const result = resolveRef('now', scope);
    expect(result.success).toBe(true);
    if (!result.success) throw new ScraperError('now should resolve');
    const n = result.value as number;
    expect(n).toBeGreaterThan(10 ** 9);
    expect(n).toBeLessThan(10 ** 11);
  });

  it('returns a millisecond number for nowMs', (): void => {
    const scope = makeScope();
    const result = resolveRef('nowMs', scope);
    expect(result.success).toBe(true);
    if (!result.success) throw new ScraperError('nowMs should resolve');
    const n = result.value as number;
    expect(n).toBeGreaterThan(10 ** 12);
  });
});

describe('RefResolver.resolveRef keypair', () => {
  it('returns ec.publicKeyBase64 when scope.keypair.ec is present', (): void => {
    const ec = makeTestKeypair();
    const scope = makeScope({ keypair: { ec } });
    const result = resolveRef('keypair.ec.publicKeyBase64', scope);
    expect(result.success).toBe(true);
    if (!result.success) throw new ScraperError('ec keypair should resolve');
    expect(result.value).toBe(ec.publicKeyBase64);
  });

  it('fails when scope.keypair is absent', (): void => {
    const scope = makeScope();
    const result = resolveRef('keypair.ec.publicKeyBase64', scope);
    expect(result.success).toBe(false);
    if (!result.success) expect(result.errorMessage).toContain('scope.keypair is absent');
  });

  it('fails when scope.keypair.ec is missing for an ec ref', (): void => {
    const rsa = makeTestKeypair();
    const scope = makeScope({ keypair: { rsa } });
    const result = resolveRef('keypair.ec.publicKeyBase64', scope);
    expect(result.success).toBe(false);
    if (!result.success) expect(result.errorMessage).toContain('scope.keypair.ec is absent');
  });

  it('fails when scope.keypair.rsa is missing for an rsa ref', (): void => {
    const ec = makeTestKeypair();
    const scope = makeScope({ keypair: { ec } });
    const result = resolveRef('keypair.rsa.publicKeyBase64', scope);
    expect(result.success).toBe(false);
    if (!result.success) expect(result.errorMessage).toContain('scope.keypair.rsa is absent');
  });

  it('fails for an unknown keypair ref shape', (): void => {
    const ec = makeTestKeypair();
    const scope = makeScope({ keypair: { ec } });
    const result = resolveRef('keypair.unknown.field' as RefToken, scope);
    expect(result.success).toBe(false);
    if (!result.success) expect(result.errorMessage).toContain('unknown keypair ref');
  });
});

describe('RefResolver.resolveRef carry', () => {
  it('returns the carry value when present', (): void => {
    const scope = makeScope({ carry: { token: 'abc' } });
    const result = resolveRef('carry.token', scope);
    expect(result.success).toBe(true);
    if (!result.success) throw new ScraperError('carry should resolve');
    expect(result.value).toBe('abc');
  });

  it('fails when the named carry field is undefined', (): void => {
    const scope = makeScope();
    const result = resolveRef('carry.absent', scope);
    expect(result.success).toBe(false);
    if (!result.success) expect(result.errorMessage).toContain('carry.absent');
  });
});

describe('RefResolver.resolveRef creds', () => {
  it('returns a string creds value via coerceToJsonValue', (): void => {
    const scope = makeScope({ creds: { password: '0000' } });
    const result = resolveRef('creds.password', scope);
    expect(result.success).toBe(true);
    if (!result.success) throw new ScraperError('creds should resolve');
    expect(result.value).toBe('0000');
  });

  it('returns a number creds value verbatim', (): void => {
    const scope = makeScope({ creds: { attempt: 3 } });
    const result = resolveRef('creds.attempt', scope);
    expect(result.success).toBe(true);
    if (!result.success) throw new ScraperError('creds number should resolve');
    expect(result.value).toBe(3);
  });

  it('returns a boolean creds value verbatim', (): void => {
    const scope = makeScope({ creds: { enabled: true } });
    const result = resolveRef('creds.enabled', scope);
    expect(result.success).toBe(true);
    if (!result.success) throw new ScraperError('creds boolean should resolve');
    expect(result.value).toBe(true);
  });

  it('returns null creds verbatim', (): void => {
    const scope = makeScope({ creds: { mark: null } });
    const result = resolveRef('creds.mark', scope);
    expect(result.success).toBe(true);
    if (!result.success) throw new ScraperError('creds null should resolve');
    expect(result.value).toBeNull();
  });

  it('fails on non-JSON creds like functions', (): void => {
    const scope = makeScope({ creds: { fn: NON_SERIALIZABLE_FN } });
    const result = resolveRef('creds.fn', scope);
    expect(result.success).toBe(false);
    if (!result.success) expect(result.errorMessage).toContain('not JSON-serialisable');
  });

  it('fails when creds slot is undefined', (): void => {
    const scope = makeScope();
    const result = resolveRef('creds.missing', scope);
    expect(result.success).toBe(false);
    if (!result.success) expect(result.errorMessage).toContain('creds.missing');
  });
});

describe('RefResolver.resolveRef config', () => {
  it('resolves a dotted config path', (): void => {
    const scope = makeScope();
    const result = resolveRef('config.signer.canonical.clientVersion', scope);
    expect(result.success).toBe(true);
    if (!result.success) throw new ScraperError('config should resolve');
    expect(result.value).toBe('9.9.9');
  });

  it('fails when the config path does not exist', (): void => {
    const scope = makeScope();
    const result = resolveRef('config.nonexistent.field', scope);
    expect(result.success).toBe(false);
    if (!result.success) expect(result.errorMessage).toContain('config.nonexistent.field');
  });
});

describe('RefResolver.resolveRef unknown token', () => {
  it('fails when the token matches no handler and no prefix', (): void => {
    const scope = makeScope();
    const result = resolveRef('completely.unknown' as RefToken, scope);
    expect(result.success).toBe(false);
    if (!result.success) expect(result.errorMessage).toContain('unknown ref token');
  });
});

/** Raw cookie values the step URL sees, by name. */
const JAR: Readonly<Record<string, string>> = {
  csrfcookie: 'a%2Fb%3D%20c',
  plain: 'plain',
  edge: 'y'.repeat(4096),
  broken: '%E0%A4%A',
  long: 'x'.repeat(4097),
};

/**
 * The step's cookie view over JAR.
 * @param name - Cookie name.
 * @returns The raw value, or none.
 */
function jarLookup(name: string): Option<string> {
  if (!Object.hasOwn(JAR, name)) return none();
  return some(JAR[name]);
}

/**
 * Resolve one cookie ref through a scope.
 * @param name - Cookie name.
 * @param cookie - The scope's cookie view.
 * @returns The resolver result.
 */
function cookieRef(name: string, cookie?: CookieLookup): ReturnType<typeof resolveRef> {
  const scope = makeScope({ cookie });
  return resolveRef(`cookie.${name}`, scope);
}

describe('RefResolver.resolveRef cookie', () => {
  it.each([
    ['csrfcookie', 'a/b= c'],
    ['plain', 'plain'],
    ['edge', JAR.edge],
  ])('cookie.%s resolves to the URL-decoded value', (name, expected): void => {
    const result = cookieRef(name, jarLookup);
    expect(result).toEqual({ success: true, value: expected });
  });

  it.each(['broken', 'long'])('cookie.%s fails "bad" without the value', (name): void => {
    const result = cookieRef(name, jarLookup);
    expect(result).toMatchObject({ success: false, errorMessage: `ref cookie.${name} bad` });
  });

  it('fails "miss" for a cookie the step URL does not see', (): void => {
    const result = cookieRef('absent', jarLookup);
    expect(result).toMatchObject({ success: false, errorMessage: 'ref cookie.absent miss' });
  });

  it('fails "miss" when the scope has no cookie view', (): void => {
    const result = cookieRef('csrfcookie');
    expect(result).toMatchObject({ success: false, errorMessage: 'ref cookie.csrfcookie miss' });
  });
});
