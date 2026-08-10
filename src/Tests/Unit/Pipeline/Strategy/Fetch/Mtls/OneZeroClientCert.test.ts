/**
 * Unit tests for Strategy/Fetch/Mtls/OneZeroClientCert.resolveOneZeroClientCert.
 * Covers: bundled base64 default decode; inline-PEM and path env overrides; the
 * fail-closed paths (unreadable override, non-PEM override, half-configured
 * override pair, cert/key mismatch); the near-expiry WARN branch (Date.now
 * mocked near the bundled validTo); the unparseable-cert expiry skip; and
 * per-branch expiry message selection.
 * Env overrides are snapshotted and restored around the suite.
 */

import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { jest } from '@jest/globals';

import {
  emitExpiryWarning,
  EXPIRED_MSG,
  expiryMessage,
  NEAR_EXPIRY_MSG,
  resolveOneZeroClientCert,
  warnIfExpiring,
} from '../../../../../../Scrapers/Pipeline/Strategy/Fetch/Mtls/OneZeroClientCert.js';
import { MTLS_TEST_KEY_B64 } from './MtlsTestCertData.js';

const CERT_ENV = 'ONEZERO_MTLS_CERT';
const KEY_ENV = 'ONEZERO_MTLS_KEY';

/**
 * A syntactically valid PEM private key from an unrelated keypair (the loopback
 * test fixture), used to prove the cert/key pairing check actually rejects.
 */
const MISMATCHED_KEY_B64 = MTLS_TEST_KEY_B64.replaceAll(/\s+/g, '');
const MISMATCHED_KEY_BYTES = Buffer.from(MISMATCHED_KEY_B64, 'base64');
const MISMATCHED_KEY_PEM = MISMATCHED_KEY_BYTES.toString('utf8');

/** Snapshot of one env var: whether it was present and its value. */
interface IEnvSnapshot {
  readonly present: boolean;
  readonly value: string;
}

/**
 * Capture the current state of an env var for later restoration.
 * @param name - The env var name.
 * @returns Snapshot recording presence + value.
 */
function snapshotEnv(name: string): IEnvSnapshot {
  const current = process.env[name];
  if (current === undefined) return { present: false, value: '' };
  return { present: true, value: current };
}

/**
 * Restore one env var to its snapshotted state (deleting when it was unset).
 * @param name - The env var name.
 * @param snap - The captured snapshot.
 * @returns True when a value was restored, false when the var was deleted.
 */
function restoreEnv(name: string, snap: IEnvSnapshot): boolean {
  if (!snap.present) {
    Reflect.deleteProperty(process.env, name);
    return false;
  }
  process.env[name] = snap.value;
  return true;
}

/**
 * Write content to a fresh temp file and return its path.
 * @param content - File body to write.
 * @returns Absolute path to the created temp file.
 */
function writeTempFile(content: string): string {
  const base = tmpdir();
  const prefix = join(base, 'oz-mtls-');
  const dir = mkdtempSync(prefix);
  const filePath = join(dir, 'material.pem');
  writeFileSync(filePath, content, 'utf8');
  return filePath;
}

describe('resolveOneZeroClientCert', () => {
  let certSnapshot: IEnvSnapshot;
  let keySnapshot: IEnvSnapshot;

  beforeAll(() => {
    certSnapshot = snapshotEnv(CERT_ENV);
    keySnapshot = snapshotEnv(KEY_ENV);
  });
  afterAll(() => {
    restoreEnv(CERT_ENV, certSnapshot);
    restoreEnv(KEY_ENV, keySnapshot);
  });
  beforeEach(() => {
    Reflect.deleteProperty(process.env, CERT_ENV);
    Reflect.deleteProperty(process.env, KEY_ENV);
  });
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('decodes the bundled base64 default into valid PEM cert + key', () => {
    const bundle = resolveOneZeroClientCert();
    expect(bundle.cert).toContain('BEGIN CERTIFICATE');
    expect(bundle.key).toContain('PRIVATE KEY');
  });

  it('uses an inline-PEM env override verbatim for the cert', () => {
    const reference = resolveOneZeroClientCert();
    process.env[CERT_ENV] = reference.cert;
    process.env[KEY_ENV] = reference.key;
    const bundle = resolveOneZeroClientCert();
    expect(bundle.cert).toBe(reference.cert);
  });

  it('reads a filesystem-path env override for the cert', () => {
    const reference = resolveOneZeroClientCert();
    const filePath = writeTempFile(reference.cert);
    process.env[CERT_ENV] = filePath;
    process.env[KEY_ENV] = reference.key;
    const bundle = resolveOneZeroClientCert();
    expect(bundle.cert).toBe(reference.cert);
  });

  it('throws rather than falling back when the override path cannot be read', () => {
    const base = tmpdir();
    const missing = join(base, 'oz-mtls-does-not-exist.pem');
    process.env[CERT_ENV] = missing;
    process.env[KEY_ENV] = missing;
    expect(resolveOneZeroClientCert).toThrow(/read failed/);
  });

  it('throws rather than falling back when the override file holds no PEM', () => {
    const filePath = writeTempFile('this file has no pem material');
    process.env[CERT_ENV] = filePath;
    process.env[KEY_ENV] = filePath;
    expect(resolveOneZeroClientCert).toThrow(/not PEM material/);
  });

  it('throws when only the cert override is set (incomplete pair)', () => {
    const reference = resolveOneZeroClientCert();
    process.env[CERT_ENV] = reference.cert;
    expect(resolveOneZeroClientCert).toThrow(/set both/);
  });

  it('throws when only the key override is set (incomplete pair)', () => {
    const reference = resolveOneZeroClientCert();
    process.env[KEY_ENV] = reference.key;
    expect(resolveOneZeroClientCert).toThrow(/set both/);
  });

  it('throws when the override key does not match the override cert', () => {
    const reference = resolveOneZeroClientCert();
    process.env[CERT_ENV] = reference.cert;
    process.env[KEY_ENV] = MISMATCHED_KEY_PEM;
    expect(resolveOneZeroClientCert).toThrow(/do not match/);
  });

  it('emits the near-expiry branch and reports a warning when now is within the window', () => {
    const nearDate = new Date('2027-06-20T00:00:00Z');
    const nearMs = nearDate.getTime();
    jest.spyOn(Date, 'now').mockReturnValue(nearMs);
    const bundle = resolveOneZeroClientCert();
    expect(bundle.cert).toContain('BEGIN CERTIFICATE');
    const didWarn = warnIfExpiring(bundle.cert);
    expect(didWarn).toBe(true);
  });
});

describe('warnIfExpiring', () => {
  it('skips the expiry check when the cert is unparseable', () => {
    const junkPem = '-----BEGIN CERTIFICATE-----\nnot-real-der\n-----END CERTIFICATE-----';
    const didWarn = warnIfExpiring(junkPem);
    expect(didWarn).toBe(false);
  });
});

describe('expiryMessage', () => {
  it('selects no message comfortably before the warn window', () => {
    const message = expiryMessage(90);
    expect(message).toBe('');
  });

  it('selects the near-expiry message inside the window', () => {
    const message = expiryMessage(15);
    expect(message).toBe(NEAR_EXPIRY_MSG);
  });

  it('selects the expired message for negative days', () => {
    const message = expiryMessage(-5);
    expect(message).toBe(EXPIRED_MSG);
  });

  it('keeps the expired and near-expiry texts distinguishable', () => {
    expect(EXPIRED_MSG).not.toBe(NEAR_EXPIRY_MSG);
  });
});

describe('emitExpiryWarning', () => {
  it('does not warn when the cert is comfortably before the warn window', () => {
    const didWarn = emitExpiryWarning(90);
    expect(didWarn).toBe(false);
  });

  it('warns when the cert is within the near-expiry window', () => {
    const didWarn = emitExpiryWarning(15);
    expect(didWarn).toBe(true);
  });

  it('warns when the cert is already expired (negative days)', () => {
    const didWarn = emitExpiryWarning(-5);
    expect(didWarn).toBe(true);
  });
});
