/**
 * Unit tests for the cryptoField preHook — encrypts a creds-retrieved
 * value (e.g. OTP digits) at a JSON pointer inside the body, scrubs
 * the plaintext from the carry sentinel, and appends an optional
 * postfix.
 *
 * Test ordering: red-test-first per orientation.txt §3. Hook lives
 * in SmsOtpFlow.applyPreHook; T16 commits the implementation in the
 * same atomic change so the pre-commit hook's test:pipeline gate
 * stays green.
 *
 * Reference: spec.txt §3.2 + §3.3 (cryptoField hook contract).
 */

import ScraperError from '../../../../Scrapers/Base/ScraperError.js';
import { signAesCbcPkcs7 } from '../../../../Scrapers/Pipeline/Mediator/ApiDirectCall/Crypto/AesSymmetricSigner.js';
import type { Procedure } from '../../../../Scrapers/Pipeline/Types/Procedure.js';

/** Args bundle for the cryptoField hook — respects 3-param ceiling. */
interface ICryptoFieldHookArgs {
  readonly carry: Readonly<Record<string, unknown>>;
  readonly body: Record<string, unknown>;
  readonly cryptoField: {
    readonly keyBytes: Buffer;
    readonly ivBytes: Buffer;
    readonly outputPostfix?: string;
    readonly writeTo: string;
    readonly scrubFromCarry: string;
  };
}

/** Result returned by the cryptoField hook. */
interface ICryptoFieldHookResult {
  readonly carry: Readonly<Record<string, unknown>>;
  readonly body: Record<string, unknown>;
}

/** Module-under-test shape resolved via dynamic import. */
interface ICryptoFieldModule {
  readonly applyCryptoField: (args: ICryptoFieldHookArgs) => Procedure<ICryptoFieldHookResult>;
}

/** Module specifier — lazy load for red-test-first. */
const MODULE_SPECIFIER = '../../../../Scrapers/Pipeline/Mediator/ApiDirectCall/Flow/RunStep.js';

/** Synthetic 32-byte AES-256 key (exactly 32 chars). */
const FIXT_OTP_KEY = 'fixt-otp-key-pb-0001fixt-otp-key';
const FIXT_PIN_IV_HEX = 'ffeeddccbbaa99887766554433221100';

/**
 * Lazy load the cryptoField hook from SmsOtpFlow.
 * @returns Module with applyCryptoField.
 */
async function loadModule(): Promise<ICryptoFieldModule> {
  const mod = (await import(MODULE_SPECIFIER)) as ICryptoFieldModule;
  return mod;
}

describe('applyCryptoField — encrypts plaintext at body pointer', () => {
  it('UC-CFH-1: writes base64 ciphertext + postfix at /pin pointer', async () => {
    const mod = await loadModule();
    const body = { phoneNum: '972-fixt-phone-pb-0001' } as Record<string, unknown>;
    const carry = { otpDigitsPlain: '9255' } as Readonly<Record<string, unknown>>;
    const result = mod.applyCryptoField({
      carry,
      body,
      cryptoField: {
        keyBytes: Buffer.from(FIXT_OTP_KEY, 'utf8'),
        ivBytes: Buffer.from(FIXT_PIN_IV_HEX, 'hex'),
        outputPostfix: '\n',
        writeTo: '/pin',
        scrubFromCarry: 'otpDigitsPlain',
      },
    });
    expect(result.success).toBe(true);
    if (!result.success) throw new ScraperError('applyCryptoField must succeed');
    const expected = signAesCbcPkcs7({
      plaintext: '9255',
      keyBytes: Buffer.from(FIXT_OTP_KEY, 'utf8'),
      ivBytes: Buffer.from(FIXT_PIN_IV_HEX, 'hex'),
      outputPostfix: '\n',
    });
    expect(expected.success).toBe(true);
    if (!expected.success) throw new ScraperError('expected sign must succeed');
    expect(result.value.body.pin).toBe(expected.value);
    expect(result.value.body.phoneNum).toBe('972-fixt-phone-pb-0001');
  });
});

describe('applyCryptoField — scrubs plaintext from carry', () => {
  it('UC-CFH-2: replaces plaintext carry slot with redaction sentinel', async () => {
    const mod = await loadModule();
    const body = {} as Record<string, unknown>;
    const carry = { otpDigitsPlain: '9255', other: 'keep-me' } as Readonly<Record<string, unknown>>;
    const result = mod.applyCryptoField({
      carry,
      body,
      cryptoField: {
        keyBytes: Buffer.from(FIXT_OTP_KEY, 'utf8'),
        ivBytes: Buffer.from(FIXT_PIN_IV_HEX, 'hex'),
        writeTo: '/pin',
        scrubFromCarry: 'otpDigitsPlain',
      },
    });
    expect(result.success).toBe(true);
    if (!result.success) throw new ScraperError('applyCryptoField must succeed');
    expect(result.value.carry.otpDigitsPlain).toBe('[REDACTED:otpDigitsPlain]');
    expect(result.value.carry.other).toBe('keep-me');
  });
});

describe('applyCryptoField — omits postfix when not configured', () => {
  it('UC-CFH-3: produces raw base64 ciphertext without trailing chars', async () => {
    const mod = await loadModule();
    const body = {} as Record<string, unknown>;
    const carry = { otpDigitsPlain: '9255' } as Readonly<Record<string, unknown>>;
    const result = mod.applyCryptoField({
      carry,
      body,
      cryptoField: {
        keyBytes: Buffer.from(FIXT_OTP_KEY, 'utf8'),
        ivBytes: Buffer.from(FIXT_PIN_IV_HEX, 'hex'),
        writeTo: '/pin',
        scrubFromCarry: 'otpDigitsPlain',
      },
    });
    expect(result.success).toBe(true);
    if (!result.success) throw new ScraperError('applyCryptoField must succeed');
    const pinValue = result.value.body.pin as string;
    const hasNewlineSuffix = pinValue.endsWith('\n');
    expect(hasNewlineSuffix).toBe(false);
  });
});

describe('applyCryptoField — missing carry slot fails', () => {
  it('UC-CFH-4: returns Procedure.fail when scrubFromCarry slot is absent', async () => {
    const mod = await loadModule();
    const body = {} as Record<string, unknown>;
    const carry = {} as Readonly<Record<string, unknown>>;
    const result = mod.applyCryptoField({
      carry,
      body,
      cryptoField: {
        keyBytes: Buffer.from(FIXT_OTP_KEY, 'utf8'),
        ivBytes: Buffer.from(FIXT_PIN_IV_HEX, 'hex'),
        writeTo: '/pin',
        scrubFromCarry: 'otpDigitsPlain',
      },
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.errorMessage).toContain('otpDigitsPlain');
    }
  });
});
