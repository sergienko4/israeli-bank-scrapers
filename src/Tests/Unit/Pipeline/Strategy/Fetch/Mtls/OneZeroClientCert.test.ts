/**
 * Unit tests for Strategy/Fetch/Mtls/OneZeroClientCert.resolveOneZeroClientCert.
 * Covers: bundled base64 default decode; inline-PEM env override; path env
 * override; invalid path (read failure) fallback; non-PEM file fallback;
 * near-expiry WARN branch (Date.now mocked near the bundled validTo); and the
 * unparseable-cert expiry-skip branch. Env overrides are snapshotted/restored.
 */

import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { jest } from '@jest/globals';

import {
  emitExpiryWarning,
  resolveOneZeroClientCert,
  warnIfExpiring,
} from '../../../../../../Scrapers/Pipeline/Strategy/Fetch/Mtls/OneZeroClientCert.js';

const CERT_ENV = 'ONEZERO_MTLS_CERT';
const KEY_ENV = 'ONEZERO_MTLS_KEY';

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
    const bundle = resolveOneZeroClientCert();
    expect(bundle.cert).toBe(reference.cert);
  });

  it('reads a filesystem-path env override for the cert', () => {
    const reference = resolveOneZeroClientCert();
    const filePath = writeTempFile(reference.cert);
    process.env[CERT_ENV] = filePath;
    const bundle = resolveOneZeroClientCert();
    expect(bundle.cert).toBe(reference.cert);
  });

  it('falls back to the bundled default when the override path cannot be read', () => {
    const base = tmpdir();
    const missing = join(base, 'oz-mtls-does-not-exist.pem');
    process.env[CERT_ENV] = missing;
    const bundle = resolveOneZeroClientCert();
    expect(bundle.cert).toContain('BEGIN CERTIFICATE');
  });

  it('falls back to the bundled default when the override file holds no PEM', () => {
    const filePath = writeTempFile('this file has no pem material');
    process.env[CERT_ENV] = filePath;
    const bundle = resolveOneZeroClientCert();
    expect(bundle.cert).toContain('BEGIN CERTIFICATE');
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

  it('skips the expiry check when the resolved cert is unparseable', () => {
    const junkPem = '-----BEGIN CERTIFICATE-----\nnot-real-der\n-----END CERTIFICATE-----';
    process.env[CERT_ENV] = junkPem;
    const bundle = resolveOneZeroClientCert();
    expect(bundle.cert).toBe(junkPem);
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
