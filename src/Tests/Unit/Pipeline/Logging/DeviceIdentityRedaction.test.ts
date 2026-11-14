/**
 * Redaction of the Hapoalim device identity. The seed is a long-lived
 * credential carried in `otpLongTermToken`, and the signature is the
 * Base64-wrapped `mfp` sent to the bank; neither may reach a log line or a
 * JSON dump. The test reads the production lists so a copied fixture cannot
 * drift from what the logger actually uses.
 */

import { PassThrough } from 'node:stream';

import pino from 'pino';

import { SENSITIVE_PATHS } from '../../../../Scrapers/Pipeline/Types/DebugConfig.js';
import { classifyKey, redactJsonBody } from '../../../../Scrapers/Pipeline/Types/PiiRedactor.js';

/** The device-identity fields the enricher injects. */
const DEVICE_KEYS = ['deviceSeed', 'deviceSignature', 'mfp'] as const;

/** Synthetic values; none is a real device credential. */
const SECRETS: Readonly<Record<(typeof DEVICE_KEYS)[number], string>> = {
  deviceSeed: 'syn-0123456789abcdef',
  deviceSignature: JSON.stringify({ deviceSignature: { system: { androidId: 'syn-id' } } }),
  mfp: 'c3luLW1mcA==',
};

/**
 * Log one payload through a pino logger wired to the real redaction paths.
 * @param payload - Object to log.
 * @returns The serialized log output.
 */
function logRedacted(payload: Readonly<Record<string, unknown>>): string {
  const stream = new PassThrough();
  let output = '';
  stream.on('data', (chunk: Buffer) => {
    output += chunk.toString();
  });
  const sink = pino(
    { level: 'info', redact: { paths: [...SENSITIVE_PATHS], censor: '[REDACTED]' } },
    stream,
  );
  sink.info(payload, 'device identity probe');
  return output;
}

describe('device-identity redaction', () => {
  it.each(DEVICE_KEYS)('lists %s among the pino paths', key => {
    expect([...SENSITIVE_PATHS]).toContain(key);
  });

  it.each(DEVICE_KEYS)('keeps a top-level %s out of the log stream', key => {
    const output = logRedacted({ [key]: SECRETS[key] });
    expect(output).not.toContain(SECRETS[key]);
    expect(output).toContain('[REDACTED]');
  });

  it('keeps every device field out of a credential object', () => {
    const output = logRedacted({ credentials: SECRETS });
    for (const secret of Object.values(SECRETS)) expect(output).not.toContain(secret);
    expect(output).toContain('[REDACTED]');
  });

  it.each(DEVICE_KEYS)('classifies %s as a token', key => {
    const category = classifyKey(key);
    expect(category).toBe('token');
  });

  it.each(DEVICE_KEYS)('redacts %s in a JSON dump', key => {
    const dump = redactJsonBody({ [key]: SECRETS[key] });
    expect(dump).not.toContain(SECRETS[key]);
  });
});
