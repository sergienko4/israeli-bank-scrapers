/**
 * Edge-case unit tests for {@link writeAtPointer} +
 * {@link applyCryptoField}.
 *
 * The happy paths (full AES + cryptoField round-trip) are covered by
 * `RunStepCrypto.test.ts`. This file pins the strict validation
 * branches per test-guidlines.md "unit test for edge cases only" —
 * malformed-pointer / missing-plaintext / missing-key-ref are
 * configuration-level failures the integration flow wouldn't trip
 * without polluting it with invalid fixtures.
 */

import { ScraperErrorTypes } from '../../../../../../Scrapers/Base/ErrorTypes.js';
import {
  applyCryptoField,
  attachBodySignature,
  primeStepCarry,
  writeAtPointer,
} from '../../../../../../Scrapers/Pipeline/Mediator/ApiDirectCall/Flow/RunStepBodySigning.js';
import type {
  IAesSignerConfig,
  IApiDirectCallConfig,
  IStepConfig,
} from '../../../../../../Scrapers/Pipeline/Mediator/ApiDirectCall/IApiDirectCallConfig.js';
import type { ITemplateScope } from '../../../../../../Scrapers/Pipeline/Mediator/ApiDirectCall/Template/RefResolver.js';

const PLAIN_CONFIG: IApiDirectCallConfig = {
  flow: 'sms-otp',
  envelope: {},
  steps: [],
  secrets: {
    pinKey: 'crypto-pin-key-32-bytes-exactly!',
    signKey: 'aes-sign-key-32-bytes-exactly!!!',
  },
};

/**
 * Build a step carrying a preHook + cryptoField — used by tests that
 * exercise the cryptoField failure branches.
 * @param overrides - Partial step overrides.
 * @returns Step config.
 */
function makeCryptoStep(overrides: Partial<IStepConfig> = {}): IStepConfig {
  return {
    name: 'assertPassword',
    urlTag: 'auth.bind',
    body: { shape: {} },
    preHook: {
      awaitCredsField: 'pin',
      intoCarryField: 'pin',
      cryptoField: {
        keyRef: 'config.secrets.pinKey',
        ivRef: 'carry.pinIvHex',
        writeTo: '/auth/pinCipher',
        scrubFromCarry: 'pin',
      },
    },
    extractsToCarry: {},
    ...overrides,
  };
}

/**
 * Build a template scope with the given carry overrides.
 * @param carry - Carry overrides.
 * @returns Scope.
 */
function makeScope(carry: Readonly<Record<string, string>> = {}): ITemplateScope {
  return { carry, creds: {}, config: PLAIN_CONFIG };
}

describe('writeAtPointer — pointer validation', () => {
  it('rejects pointers that do not start with a slash', () => {
    const result = writeAtPointer({}, 'auth/signature', 'sig-value');
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.errorType).toBe(ScraperErrorTypes.Generic);
      expect(result.errorMessage).toContain('invalid pointer');
    }
  });

  it('writes through escaped pointer segments (~0 → ~, ~1 → /)', () => {
    const result = writeAtPointer({}, '/a~1b/c~0d', 'escaped-value');
    expect(result.success).toBe(true);
    if (result.success) {
      const child = (result.value as { 'a/b': { 'c~d': string } })['a/b'];
      expect(child['c~d']).toBe('escaped-value');
    }
  });

  it('descends through existing intermediate objects rather than replacing them', () => {
    const doc: Record<string, unknown> = { auth: { existing: 'keep-me' } };
    const result = writeAtPointer(doc, '/auth/signature', 'new-sig');
    expect(result.success).toBe(true);
    if (result.success) {
      const auth = result.value.auth as { existing: string; signature: string };
      expect(auth.existing).toBe('keep-me');
      expect(auth.signature).toBe('new-sig');
    }
  });
});

describe('applyCryptoField — strict validation branches', () => {
  it('fails when the intoCarryField slot is absent from scope.carry', () => {
    const result = applyCryptoField({
      step: makeCryptoStep(),
      scope: makeScope(),
      body: {},
    });
    expect(result.success).toBe(false);
    if (!result.success) expect(result.errorMessage).toContain('carry.pin missing');
  });

  it('fails when the keyRef cannot be resolved against scope.config', () => {
    const step = makeCryptoStep({
      preHook: {
        awaitCredsField: 'pin',
        intoCarryField: 'pin',
        cryptoField: {
          keyRef: 'config.secrets.absentKey',
          ivRef: 'carry.pinIvHex',
          writeTo: '/auth/pinCipher',
          scrubFromCarry: 'pin',
        },
      },
    });
    const scope = makeScope({ pin: '0000', pinIvHex: 'abcdef0123456789abcdef0123456789' });
    const result = applyCryptoField({ step, scope, body: {} });
    expect(result.success).toBe(false);
    if (!result.success) expect(result.errorMessage).toContain("keyRef 'config.secrets.absentKey'");
  });

  it('fails when the ivRef carry slot is absent', () => {
    const step = makeCryptoStep();
    const scope = makeScope({ pin: '0000' });
    const result = applyCryptoField({ step, scope, body: {} });
    expect(result.success).toBe(false);
    if (!result.success) expect(result.errorMessage).toContain("ivRef 'carry.pinIvHex'");
  });

  it('fails when the keyRef belongs to neither the carry. nor config. family', () => {
    const step = makeCryptoStep({
      preHook: {
        awaitCredsField: 'pin',
        intoCarryField: 'pin',
        cryptoField: {
          // Deliberate type-bypass — the prod `keyRef` type forbids
          // unprefixed strings, but the runtime guard in resolveRefValue
          // exists as a defensive fallthrough; this test pins that path.
          keyRef: 'secrets.unprefixedKey' as unknown as `config.${string}`,
          ivRef: 'carry.pinIvHex',
          writeTo: '/auth/pinCipher',
          scrubFromCarry: 'pin',
        },
      },
    });
    const scope = makeScope({ pin: '0000', pinIvHex: VALID_IV_HEX });
    const result = applyCryptoField({ step, scope, body: {} });
    expect(result.success).toBe(false);
    if (!result.success) expect(result.errorMessage).toContain("keyRef 'secrets.unprefixedKey'");
  });

  it('fails when the config.dotted path traverses through a non-object intermediate', () => {
    const stringyConfig: IApiDirectCallConfig = {
      ...PLAIN_CONFIG,
      secrets: { signKey: 'a-key-32-bytes-padding!!!!!!!!!!!' },
    };
    const step = makeCryptoStep({
      preHook: {
        awaitCredsField: 'pin',
        intoCarryField: 'pin',
        cryptoField: {
          keyRef: 'config.secrets.signKey.notAnObject',
          ivRef: 'carry.pinIvHex',
          writeTo: '/auth/pinCipher',
          scrubFromCarry: 'pin',
        },
      },
    });
    const scope: ITemplateScope = {
      carry: { pin: '0000', pinIvHex: VALID_IV_HEX },
      creds: {},
      config: stringyConfig,
    };
    const result = applyCryptoField({ step, scope, body: {} });
    expect(result.success).toBe(false);
    if (!result.success)
      expect(result.errorMessage).toContain("keyRef 'config.secrets.signKey.notAnObject'");
  });

  it('no-ops when the step carries no preHook', () => {
    const step: IStepConfig = {
      name: 'bind',
      urlTag: 'auth.bind',
      body: { shape: {} },
      extractsToCarry: {},
    };
    const result = applyCryptoField({ step, scope: makeScope(), body: { keep: 'me' } });
    expect(result.success).toBe(true);
    if (result.success) expect(result.value.body).toEqual({ keep: 'me' });
  });
});

/** AES signer used by the attachBodySignature failure-branch cases. */
const AES_SIGNER: IAesSignerConfig = {
  algorithm: 'AES-CBC-PKCS7',
  keyRef: 'config.secrets.signKey',
  ivStrategy: 'random-16',
  ivCarrySlot: 'signIvHex',
  bodySignatureField: '/auth/signature',
  canonical: {
    parts: ['bodyJson'],
    separator: '|',
    escapeFrom: '|',
    escapeTo: String.raw`\|`,
    sortQueryParams: false,
    clientVersion: '1.0',
  },
};

/** Pre-computed 32-byte hex IV used by carry overrides — avoids inline nested calls. */
const VALID_IV_HEX = 'abcdef0123456789abcdef0123456789';

/** Pre-computed alternate hex IV for idempotency tests. */
const ALT_IV_HEX = 'a'.padEnd(32, '0');

/** Pre-computed third hex IV. */
const THIRD_IV_HEX = 'b'.padEnd(32, '0');

/** Bundle for {@link makeAesScope} — keeps overrideable fields explicit. */
interface IAesScopeOverrides {
  readonly secrets?: Record<string, string>;
  readonly carry?: Record<string, string>;
}

/**
 * Build an AES-signer scope literal for the attach-body-signature
 * tests below — overrideable secrets + carry let each case zero in
 * on one failure branch.
 * @param overrides - Partial scope overrides for secrets / carry.
 * @returns ITemplateScope literal with the AES signer wired in.
 */
function makeAesScope(overrides: IAesScopeOverrides): ITemplateScope {
  const config: IApiDirectCallConfig = {
    ...PLAIN_CONFIG,
    secrets: overrides.secrets ?? PLAIN_CONFIG.secrets,
    signer: AES_SIGNER,
  };
  return { carry: overrides.carry ?? {}, creds: {}, config };
}

describe('attachBodySignature — AES signer error branches', () => {
  it('fails when the signer keyRef cannot be resolved in scope.config', () => {
    const scope = makeAesScope({ secrets: {}, carry: { signIvHex: VALID_IV_HEX } });
    const result = attachBodySignature({ scope, body: { a: 1 }, pathAndQuery: '/p' });
    expect(result.success).toBe(false);
    if (!result.success) expect(result.errorMessage).toContain("keyRef 'config.secrets.signKey'");
  });

  it('fails when the signer ivCarrySlot is absent from carry', () => {
    const scope = makeAesScope({ carry: {} });
    const result = attachBodySignature({ scope, body: { a: 1 }, pathAndQuery: '/p' });
    expect(result.success).toBe(false);
    if (!result.success) expect(result.errorMessage).toContain('carry.signIvHex missing');
  });

  it('propagates the AES primitive failure when the resolved key is too short', () => {
    const scope = makeAesScope({
      secrets: { signKey: 'tiny' },
      carry: { signIvHex: VALID_IV_HEX },
    });
    const result = attachBodySignature({ scope, body: { a: 1 }, pathAndQuery: '/p' });
    expect(result.success).toBe(false);
    if (!result.success) expect(result.errorType).toBe(ScraperErrorTypes.Generic);
  });

  it('propagates the AES primitive failure when the resolved IV is too short', () => {
    const scope = makeAesScope({ carry: { signIvHex: 'aa' } });
    const result = attachBodySignature({ scope, body: { a: 1 }, pathAndQuery: '/p' });
    expect(result.success).toBe(false);
    if (!result.success) expect(result.errorType).toBe(ScraperErrorTypes.Generic);
  });

  it('short-circuits when the bank does not declare a signer', () => {
    const scope: ITemplateScope = { carry: {}, creds: {}, config: PLAIN_CONFIG };
    const result = attachBodySignature({ scope, body: { a: 1 }, pathAndQuery: '/p' });
    expect(result.success).toBe(true);
    if (result.success) expect(result.value).toEqual({ a: 1 });
  });
});

describe('primeStepCarry — branch coverage for IV seeding', () => {
  it('preserves an existing cryptoField IV slot (idempotent reseed)', () => {
    const scope = makeAesScope({ carry: { signIvHex: ALT_IV_HEX, pinIvHex: THIRD_IV_HEX } });
    const step = makeCryptoStep();
    const result = primeStepCarry(scope, step);
    expect(result.carry.pinIvHex).toBe(THIRD_IV_HEX);
  });

  it('no-ops the cryptoField branch when the ivRef does not start with carry.', () => {
    const scope: ITemplateScope = {
      carry: {},
      creds: {},
      config: { ...PLAIN_CONFIG, signer: AES_SIGNER },
    };
    const step = makeCryptoStep({
      preHook: {
        awaitCredsField: 'pin',
        intoCarryField: 'pin',
        cryptoField: {
          keyRef: 'config.secrets.pinKey',
          // Deliberate type-bypass — prod `ivRef` requires `carry.${string}`;
          // the runtime guard in stripCarryPrefix exists as a defensive
          // fallthrough so writeCryptoIvSlot returns false instead of
          // seeding a slot from a malformed ref. This test pins that path.
          ivRef: 'config.secrets.pinIv' as unknown as `carry.${string}`,
          writeTo: '/auth/pinCipher',
          scrubFromCarry: 'pin',
        },
      },
    });
    const result = primeStepCarry(scope, step);
    expect('pinIv' in result.carry).toBe(false);
    expect(typeof result.carry.signIvHex).toBe('string');
  });
});
