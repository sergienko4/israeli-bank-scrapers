/**
 * Redaction coverage for the durable warm-start credential (issue #576).
 *
 * The same long-lived token travels under three different names — the
 * credentials field `otpLongTermToken`, the `onAuthFlowComplete` payload key
 * `longTermToken`, and the public result field `persistentOtpToken`. pino's
 * `redact.paths` matches names exactly, so a missing alias is a silent leak of
 * a credential that now survives for months rather than an hour.
 *
 * This suite reads the real {@link SENSITIVE_PATHS} rather than a copy: a list
 * duplicated into a test can drift from the one production actually uses.
 */

import { PassThrough } from 'node:stream';

import pino from 'pino';

import { SENSITIVE_PATHS } from '../../../../Scrapers/Pipeline/Types/DebugConfig.js';

/** Every name the durable warm-start credential is published under. */
const DURABLE_TOKEN_ALIASES: readonly string[] = [
  'otpLongTermToken',
  'longTermToken',
  'persistentOtpToken',
];

const SECRET = 'eyJhbGciOiJub25lIn0.super-secret-durable-handle.sig';

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
  sink.info(payload, 'durable token probe');
  return output;
}

describe('durable warm-start credential redaction', () => {
  it.each(DURABLE_TOKEN_ALIASES)('lists %s among the redacted paths', alias => {
    expect([...SENSITIVE_PATHS]).toContain(alias);
  });

  it.each(DURABLE_TOKEN_ALIASES)('keeps a %s value out of the log stream', alias => {
    const output = logRedacted({ [alias]: SECRET });
    expect(output).not.toContain(SECRET);
    expect(output).toContain('[REDACTED]');
  });
});
