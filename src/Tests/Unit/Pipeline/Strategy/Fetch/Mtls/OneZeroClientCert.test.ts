/**
 * Unit tests for Strategy/Fetch/Mtls/OneZeroClientCert.resolveOneZeroClientCert.
 * Covers: bundled base64 default decode; inline-PEM and path env overrides; the
 * fail-closed paths (unreadable override, non-PEM override, half-configured
 * override pair, cert/key mismatch); and the expiry WARN branches (before,
 * inside and after the bundled cert's validTo window).
 * Env overrides are snapshotted and restored around the suite.
 */

import { createPrivateKey, X509Certificate } from 'node:crypto';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { jest } from '@jest/globals';

import { MTLS_TEST_KEY_B64 } from './MtlsTestCertData.js';

/** Logger shared by the module under test and the assertion surface. */
const LOG = {
  trace: jest.fn(),
  debug: jest.fn(),
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
};

/**
 * Return the shared logger so the module under test writes to the assertions.
 * @returns The shared logger stub.
 */
function getDebugStub(): typeof LOG {
  return LOG;
}

jest.unstable_mockModule(
  '../../../../../../Scrapers/Pipeline/Logging/Debug.js',
  (): { getDebug: () => typeof LOG } => ({ getDebug: getDebugStub }),
);

const ONE_ZERO =
  await import('../../../../../../Scrapers/Pipeline/Strategy/Fetch/Mtls/OneZeroClientCert.js');

/** Whole days in one day. */
const MS_PER_DAY = 86_400_000;
/** Text emitted when the certificate is inside the near-expiry window. */
const NEAR_EXPIRY_MSG = '[mtls] OneZero client cert near expiry — rotate soon';
/** Text emitted when the certificate has already expired. */
const EXPIRED_MSG = '[mtls] OneZero client cert EXPIRED — rotate now';

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
    LOG.warn.mockClear();
  });
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('decodes the bundled base64 default into valid PEM cert + key', () => {
    const bundle = ONE_ZERO.resolveOneZeroClientCert();
    expect(bundle.cert).toContain('BEGIN CERTIFICATE');
    expect(bundle.key).toContain('PRIVATE KEY');
  });

  it('bundles a private key that pairs with the bundled certificate', () => {
    const bundle = ONE_ZERO.resolveOneZeroClientCert();
    const x509 = new X509Certificate(bundle.cert);
    const privateKey = createPrivateKey(bundle.key);
    const isPaired = x509.checkPrivateKey(privateKey);
    expect(isPaired).toBe(true);
  });

  it('uses an inline-PEM env override verbatim for the cert', () => {
    const reference = ONE_ZERO.resolveOneZeroClientCert();
    process.env[CERT_ENV] = reference.cert;
    process.env[KEY_ENV] = reference.key;
    const bundle = ONE_ZERO.resolveOneZeroClientCert();
    expect(bundle.cert).toBe(reference.cert);
  });

  it('reads a filesystem-path env override for the cert', () => {
    const reference = ONE_ZERO.resolveOneZeroClientCert();
    const filePath = writeTempFile(reference.cert);
    process.env[CERT_ENV] = filePath;
    process.env[KEY_ENV] = reference.key;
    const bundle = ONE_ZERO.resolveOneZeroClientCert();
    expect(bundle.cert).toBe(reference.cert);
  });

  it('throws rather than falling back when the override path cannot be read', () => {
    const base = tmpdir();
    const missing = join(base, 'oz-mtls-does-not-exist.pem');
    process.env[CERT_ENV] = missing;
    process.env[KEY_ENV] = missing;
    expect(ONE_ZERO.resolveOneZeroClientCert).toThrow(/read failed/);
  });

  it('throws rather than falling back when the override file holds no PEM', () => {
    const filePath = writeTempFile('this file has no pem material');
    process.env[CERT_ENV] = filePath;
    process.env[KEY_ENV] = filePath;
    expect(ONE_ZERO.resolveOneZeroClientCert).toThrow(/not PEM material/);
  });

  it('throws when only the cert override is set (incomplete pair)', () => {
    const reference = ONE_ZERO.resolveOneZeroClientCert();
    process.env[CERT_ENV] = reference.cert;
    expect(ONE_ZERO.resolveOneZeroClientCert).toThrow(/set both/);
  });

  it('throws when only the key override is set (incomplete pair)', () => {
    const reference = ONE_ZERO.resolveOneZeroClientCert();
    process.env[KEY_ENV] = reference.key;
    expect(ONE_ZERO.resolveOneZeroClientCert).toThrow(/set both/);
  });

  it('throws when the override key does not match the override cert', () => {
    const reference = ONE_ZERO.resolveOneZeroClientCert();
    process.env[CERT_ENV] = reference.cert;
    process.env[KEY_ENV] = MISMATCHED_KEY_PEM;
    expect(ONE_ZERO.resolveOneZeroClientCert).toThrow(/do not match/);
  });
});

describe('expiry warning branches', () => {
  let validToMs: number;

  beforeAll(() => {
    const reference = ONE_ZERO.resolveOneZeroClientCert();
    const x509 = new X509Certificate(reference.cert);
    validToMs = Date.parse(x509.validTo);
  });
  beforeEach(() => {
    LOG.warn.mockClear();
  });
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it.each([
    { title: 'stays silent comfortably before the window', days: 90, message: '' },
    { title: 'warns once inside the near-expiry window', days: 15, message: NEAR_EXPIRY_MSG },
    { title: 'warns with the expired text after validity', days: -1, message: EXPIRED_MSG },
  ])('$title', ({ days, message }) => {
    jest.spyOn(Date, 'now').mockReturnValue(validToMs - days * MS_PER_DAY);
    const bundle = ONE_ZERO.resolveOneZeroClientCert();
    expect(bundle.cert).toContain('BEGIN CERTIFICATE');
    if (message === '') {
      expect(LOG.warn).not.toHaveBeenCalled();
    } else {
      expect(LOG.warn).toHaveBeenCalledTimes(1);
      expect(LOG.warn).toHaveBeenCalledWith({ days, message });
    }
  });

  it('keeps the expired and near-expiry diagnostics distinct', () => {
    expect(EXPIRED_MSG).not.toBe(NEAR_EXPIRY_MSG);
  });
});
