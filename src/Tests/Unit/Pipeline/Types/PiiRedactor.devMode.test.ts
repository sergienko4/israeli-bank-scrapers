/**
 * Unit tests for PiiRedactor LOCAL DEV MODE (`PII_REDACTION=off`).
 * Kept in a separate file to respect the 600-line cap on the main
 * PiiRedactor test suite.
 *
 * The toggle is captured into a module-level constant at module
 * load. Each test sets `process.env.PII_REDACTION`, calls
 * `jest.resetModules()`, and re-imports the module so the captured
 * constant reflects the override.
 *
 * All fixtures below are SYNTHETIC — repeating-digit accounts,
 * placeholder names, fake URLs — so the file can be safely shared.
 */

import { jest } from '@jest/globals';

import type * as PiiRedactorModuleType from '../../../../Scrapers/Pipeline/Types/PiiRedactor.js';

type PiiRedactorModule = typeof PiiRedactorModuleType;

const PII_MODULE_PATH = '../../../../Scrapers/Pipeline/Types/PiiRedactor.js';
const ENV_DELETE_SENTINEL = '__delete__';

/** Synthetic Hapoalim-shaped account (all 9s — never a real number). */
const SYNTH_ACCOUNT = '99-999-999999';
/** Synthetic 16-digit card (repeating pattern). */
const SYNTH_CARD = '1111222233334444';
/** Synthetic 9-digit Israeli ID (all 9s). */
const SYNTH_ID = '999999999';
/** Synthetic phone number. */
const SYNTH_PHONE = '999-9999999';
/** Synthetic personal name. */
const SYNTH_NAME = 'Test User';
/** Synthetic merchant name. */
const SYNTH_MERCHANT = 'Test Shop';
/** Synthetic OTP digits. */
const SYNTH_OTP = '999999';

/**
 * Re-import PiiRedactor with `PII_REDACTION` set to `envValue`. Pass
 * the sentinel `__delete__` to test the unset-env (default-on) path.
 * @param envValue - Override value or the delete sentinel.
 * @returns Freshly-loaded module instance.
 */
async function loadPiiRedactorWithEnv(envValue: string): Promise<PiiRedactorModule> {
  const prior = process.env.PII_REDACTION;
  if (envValue === ENV_DELETE_SENTINEL) delete process.env.PII_REDACTION;
  else process.env.PII_REDACTION = envValue;
  jest.resetModules();
  const mod = (await import(PII_MODULE_PATH)) as PiiRedactorModule;
  if (prior === undefined) delete process.env.PII_REDACTION;
  else process.env.PII_REDACTION = prior;
  return mod;
}

describe('PiiRedactor — PII_REDACTION=off business-data passthrough', () => {
  it('redactAccount passes the raw value through', async () => {
    const mod = await loadPiiRedactorWithEnv('off');
    const out = mod.redactAccount(SYNTH_ACCOUNT);
    expect(out).toBe(SYNTH_ACCOUNT);
  });

  it('redactCard passes the raw value through', async () => {
    const mod = await loadPiiRedactorWithEnv('off');
    const out = mod.redactCard(SYNTH_CARD);
    expect(out).toBe(SYNTH_CARD);
  });

  it('redactIsraeliId passes the raw value through', async () => {
    const mod = await loadPiiRedactorWithEnv('off');
    const out = mod.redactIsraeliId(SYNTH_ID);
    expect(out).toBe(SYNTH_ID);
  });

  it('redactPhone passes the raw value through', async () => {
    const mod = await loadPiiRedactorWithEnv('off');
    const out = mod.redactPhone(SYNTH_PHONE);
    expect(out).toBe(SYNTH_PHONE);
  });

  it('redactName passes the raw value through', async () => {
    const mod = await loadPiiRedactorWithEnv('off');
    const out = mod.redactName(SYNTH_NAME);
    expect(out).toBe(SYNTH_NAME);
  });

  it('redactMerchant passes the raw value through', async () => {
    const mod = await loadPiiRedactorWithEnv('off');
    const out = mod.redactMerchant(SYNTH_MERCHANT);
    expect(out).toBe(SYNTH_MERCHANT);
  });

  it('redactAmount returns numeric value as a string', async () => {
    const mod = await loadPiiRedactorWithEnv('off');
    const negative = mod.redactAmount(-50);
    const positive = mod.redactAmount(1500);
    expect(negative).toBe('-50');
    expect(positive).toBe('1500');
  });

  it('redactUrl passes the URL through unchanged', async () => {
    const mod = await loadPiiRedactorWithEnv('off');
    const url = `https://test.example/api/lastTransactions/${SYNTH_CARD}/Date?accountId=${SYNTH_ACCOUNT}`;
    const out = mod.redactUrl(url);
    expect(out).toBe(url);
  });

  it('redactUrlFull passes the URL through unchanged', async () => {
    const mod = await loadPiiRedactorWithEnv('off');
    const url = `https://test.example/api/lastTransactions/${SYNTH_CARD}/Date?accountId=${SYNTH_ACCOUNT}`;
    const out = mod.redactUrlFull(url);
    expect(out).toBe(url);
  });

  it('redactJsonBody passes string body through unchanged', async () => {
    const mod = await loadPiiRedactorWithEnv('off');
    const raw = `{"firstName":"${SYNTH_NAME}","balance":1500}`;
    const out = mod.redactJsonBody(raw);
    expect(out).toBe(raw);
  });

  it('redactJsonBody serializes parsed JsonValue tree without redacting', async () => {
    const mod = await loadPiiRedactorWithEnv('off');
    const tree = { firstName: SYNTH_NAME, balance: 1500 };
    const out = mod.redactJsonBody(tree);
    expect(out).toContain(`"firstName":"${SYNTH_NAME}"`);
    expect(out).toContain('"balance":1500');
  });

  it('redactHtml passes HTML through unchanged', async () => {
    const mod = await loadPiiRedactorWithEnv('off');
    const html = `<input value="${SYNTH_NAME}" />`;
    const out = mod.redactHtml(html);
    expect(out).toBe(html);
  });
});

describe('PiiRedactor — PII_REDACTION=off auth values also pass through (full dev visibility)', () => {
  it('redactToken passes the raw token through', async () => {
    const mod = await loadPiiRedactorWithEnv('off');
    const raw = 'Bearer fake.eyJ.placeholder';
    const out = mod.redactToken(raw);
    expect(out).toBe(raw);
  });

  it('redactOtp passes the raw OTP through', async () => {
    const mod = await loadPiiRedactorWithEnv('off');
    const out = mod.redactOtp(SYNTH_OTP);
    expect(out).toBe(SYNTH_OTP);
  });

  it('redactCookie passes the raw cookie through', async () => {
    const mod = await loadPiiRedactorWithEnv('off');
    const raw = 'session=fake-placeholder';
    const out = mod.redactCookie(raw);
    expect(out).toBe(raw);
  });

  it('createCensorFn passes authorization through in dev mode', async () => {
    const mod = await loadPiiRedactorWithEnv('off');
    const censor = mod.createCensorFn();
    const raw = 'Bearer fake-token';
    const out = censor(raw, ['authorization']);
    expect(out).toBe(raw);
  });

  it('createCensorFn passes OTP through in dev mode', async () => {
    const mod = await loadPiiRedactorWithEnv('off');
    const censor = mod.createCensorFn();
    const out = censor(SYNTH_OTP, ['otpCode']);
    expect(out).toBe(SYNTH_OTP);
  });

  it('createCensorFn passes cookie through in dev mode', async () => {
    const mod = await loadPiiRedactorWithEnv('off');
    const censor = mod.createCensorFn();
    const raw = 'session=fake';
    const out = censor(raw, ['cookie']);
    expect(out).toBe(raw);
  });

  it('createCensorFn passes business-data accountNumber through in dev mode', async () => {
    const mod = await loadPiiRedactorWithEnv('off');
    const censor = mod.createCensorFn();
    const out = censor(SYNTH_ACCOUNT, ['accountNumber']);
    expect(out).toBe(SYNTH_ACCOUNT);
  });

  it('createCensorFn passes business-data balance through in dev mode', async () => {
    const mod = await loadPiiRedactorWithEnv('off');
    const censor = mod.createCensorFn();
    const out = censor(1500, ['balance']);
    expect(out).toBe('1500');
  });
});

describe('PiiRedactor — env unset keeps auth always redacted (default-on contract)', () => {
  it('redactToken redacts when env is unset', async () => {
    const mod = await loadPiiRedactorWithEnv(ENV_DELETE_SENTINEL);
    const out = mod.redactToken('Bearer abc.eyJ.def');
    expect(out).toBe('[REDACTED]');
  });

  it('redactOtp returns [OTP] hint when env is unset', async () => {
    const mod = await loadPiiRedactorWithEnv(ENV_DELETE_SENTINEL);
    const out = mod.redactOtp(SYNTH_OTP);
    expect(out).toBe('[OTP]');
  });

  it('redactCookie redacts when env is unset', async () => {
    const mod = await loadPiiRedactorWithEnv(ENV_DELETE_SENTINEL);
    const out = mod.redactCookie('session=abc');
    expect(out).toBe('[REDACTED]');
  });
});

describe('PiiRedactor — env unset keeps full redaction (default-on)', () => {
  it('redactAccount keeps redacting when env is unset', async () => {
    const mod = await loadPiiRedactorWithEnv(ENV_DELETE_SENTINEL);
    const out = mod.redactAccount(SYNTH_ACCOUNT);
    expect(out).toBe('***9999');
  });

  it('redactJsonBody keeps redacting when env is unset', async () => {
    const mod = await loadPiiRedactorWithEnv(ENV_DELETE_SENTINEL);
    const out = mod.redactJsonBody(`{"firstName":"${SYNTH_NAME}"}`);
    expect(out).toContain('<name:9>');
  });
});
