/**
 * Unit tests for RefResolver.resolveRef — covers all 6 token families:
 * fingerprint, uuid, now/nowMs, keypair.{ec|rsa}.publicKeyBase64,
 * carry.<name>, creds.<field>, config.<dotted.path>.
 */

import ScraperError from '../../../../../../Scrapers/Base/ScraperError.js';
import type { IGenericKeypair } from '../../../../../../Scrapers/Pipeline/Mediator/ApiDirectCall/Crypto/CryptoKeyFactory.js';
import { generateKeypair } from '../../../../../../Scrapers/Pipeline/Mediator/ApiDirectCall/Crypto/CryptoKeyFactory.js';
import type {
  IApiDirectCallConfig,
  RefToken,
} from '../../../../../../Scrapers/Pipeline/Mediator/ApiDirectCall/IApiDirectCallConfig.js';
import {
  type ITemplateScope,
  resolveRef,
} from '../../../../../../Scrapers/Pipeline/Mediator/ApiDirectCall/Template/RefResolver.js';

const CONFIG_STUB = {
  flow: 'sms-otp',
  steps: [],
  envelope: {},
  probe: {},
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
    const result = resolveRef('fingerprint' as RefToken, scope);
    expect(result.success).toBe(true);
    if (!result.success) throw new ScraperError('fingerprint should resolve');
    expect(result.value).toEqual({ metadata: { ts: 1 } });
  });

  it('fails when scope.fingerprint is absent', (): void => {
    const scope = makeScope();
    const result = resolveRef('fingerprint' as RefToken, scope);
    expect(result.success).toBe(false);
    if (!result.success) expect(result.errorMessage).toContain('scope.fingerprint is absent');
  });
});

describe('RefResolver.resolveRef time + uuid', () => {
  it('returns a 36-char UUID string for uuid', (): void => {
    const scope = makeScope();
    const result = resolveRef('uuid' as RefToken, scope);
    expect(result.success).toBe(true);
    if (!result.success) throw new ScraperError('uuid should resolve');
    const v = result.value as string;
    expect(v).toHaveLength(36);
  });

  it('returns a unix-seconds number for now', (): void => {
    const scope = makeScope();
    const result = resolveRef('now' as RefToken, scope);
    expect(result.success).toBe(true);
    if (!result.success) throw new ScraperError('now should resolve');
    const n = result.value as number;
    expect(n).toBeGreaterThan(10 ** 9);
    expect(n).toBeLessThan(10 ** 11);
  });

  it('returns a millisecond number for nowMs', (): void => {
    const scope = makeScope();
    const result = resolveRef('nowMs' as RefToken, scope);
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
    const result = resolveRef('keypair.ec.publicKeyBase64' as RefToken, scope);
    expect(result.success).toBe(true);
    if (!result.success) throw new ScraperError('ec keypair should resolve');
    expect(result.value).toBe(ec.publicKeyBase64);
  });

  it('fails when scope.keypair is absent', (): void => {
    const scope = makeScope();
    const result = resolveRef('keypair.ec.publicKeyBase64' as RefToken, scope);
    expect(result.success).toBe(false);
    if (!result.success) expect(result.errorMessage).toContain('scope.keypair is absent');
  });

  it('fails when scope.keypair.ec is missing for an ec ref', (): void => {
    const rsa = makeTestKeypair();
    const scope = makeScope({ keypair: { rsa } });
    const result = resolveRef('keypair.ec.publicKeyBase64' as RefToken, scope);
    expect(result.success).toBe(false);
    if (!result.success) expect(result.errorMessage).toContain('scope.keypair.ec is absent');
  });

  it('fails when scope.keypair.rsa is missing for an rsa ref', (): void => {
    const ec = makeTestKeypair();
    const scope = makeScope({ keypair: { ec } });
    const result = resolveRef('keypair.rsa.publicKeyBase64' as RefToken, scope);
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
    const result = resolveRef('carry.token' as RefToken, scope);
    expect(result.success).toBe(true);
    if (!result.success) throw new ScraperError('carry should resolve');
    expect(result.value).toBe('abc');
  });

  it('fails when the named carry field is undefined', (): void => {
    const scope = makeScope();
    const result = resolveRef('carry.absent' as RefToken, scope);
    expect(result.success).toBe(false);
    if (!result.success) expect(result.errorMessage).toContain('carry.absent');
  });
});

describe('RefResolver.resolveRef creds', () => {
  it('returns a string creds value via coerceToJsonValue', (): void => {
    const scope = makeScope({ creds: { password: '0000' } });
    const result = resolveRef('creds.password' as RefToken, scope);
    expect(result.success).toBe(true);
    if (!result.success) throw new ScraperError('creds should resolve');
    expect(result.value).toBe('0000');
  });

  it('returns a number creds value verbatim', (): void => {
    const scope = makeScope({ creds: { attempt: 3 } });
    const result = resolveRef('creds.attempt' as RefToken, scope);
    expect(result.success).toBe(true);
    if (!result.success) throw new ScraperError('creds number should resolve');
    expect(result.value).toBe(3);
  });

  it('returns a boolean creds value verbatim', (): void => {
    const scope = makeScope({ creds: { enabled: true } });
    const result = resolveRef('creds.enabled' as RefToken, scope);
    expect(result.success).toBe(true);
    if (!result.success) throw new ScraperError('creds boolean should resolve');
    expect(result.value).toBe(true);
  });

  it('returns null creds verbatim', (): void => {
    const scope = makeScope({ creds: { mark: null } });
    const result = resolveRef('creds.mark' as RefToken, scope);
    expect(result.success).toBe(true);
    if (!result.success) throw new ScraperError('creds null should resolve');
    expect(result.value).toBeNull();
  });

  it('fails on non-JSON creds like functions', (): void => {
    const scope = makeScope({ creds: { fn: NON_SERIALIZABLE_FN } });
    const result = resolveRef('creds.fn' as RefToken, scope);
    expect(result.success).toBe(false);
    if (!result.success) expect(result.errorMessage).toContain('not JSON-serialisable');
  });

  it('fails when creds slot is undefined', (): void => {
    const scope = makeScope();
    const result = resolveRef('creds.missing' as RefToken, scope);
    expect(result.success).toBe(false);
    if (!result.success) expect(result.errorMessage).toContain('creds.missing');
  });
});

describe('RefResolver.resolveRef config', () => {
  it('resolves a dotted config path', (): void => {
    const scope = makeScope();
    const result = resolveRef('config.signer.canonical.clientVersion' as RefToken, scope);
    expect(result.success).toBe(true);
    if (!result.success) throw new ScraperError('config should resolve');
    expect(result.value).toBe('9.9.9');
  });

  it('fails when the config path does not exist', (): void => {
    const scope = makeScope();
    const result = resolveRef('config.nonexistent.field' as RefToken, scope);
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
