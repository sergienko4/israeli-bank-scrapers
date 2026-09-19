/**
 * Proves that digesting a secret before asserting on it keeps the secret out
 * of the test report while leaving the comparison exact.
 *
 * <p>The first case is the hazard itself: a direct `toBe` on two secrets puts
 * both of them in the failure message. Everything after it pins the property
 * that makes the digest an honest substitute.
 */

import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';

import { ABSENT, digestFileOrAbsent, digestOf } from '../Helpers/SecretDigest.js';

/** Stand-in for a real cached bank token — used nowhere else. */
const SECRET = 'header.eyJzdWIiOiJzZWNyZXQtc3ViamVjdCJ9.signature-value';
/** A different secret, so a comparison of the two fails. */
const OTHER_SECRET = 'header.eyJzdWIiOiJvdGhlci1zdWJqZWN0In0.other-signature';

/**
 * Run an assertion and return the failure text it produced.
 * @param run - Assertion expected to throw.
 * @returns The thrown message, or '' when the assertion passed.
 */
function captureFailure(run: () => true): string {
  try {
    run();
  } catch (thrown: unknown) {
    return thrown instanceof Error ? thrown.message : String(thrown);
  }
  return '';
}

describe('digesting a secret before asserting on it', () => {
  it('shows that comparing the secrets directly puts both in the report', () => {
    /**
     * Compare the two secrets the unsafe way.
     * @returns true when the assertion somehow passes.
     */
    const unsafe = (): true => {
      expect(OTHER_SECRET).toBe(SECRET);
      return true;
    };
    const message = captureFailure(unsafe);
    const didLeak = message.includes(SECRET);
    expect(didLeak).toBe(true);
  });

  it('keeps both secrets out of the report when the digests are compared', () => {
    const left = digestOf(OTHER_SECRET);
    const right = digestOf(SECRET);
    /**
     * Compare the digests instead of the secrets.
     * @returns true when the assertion somehow passes.
     */
    const safe = (): true => {
      expect(left).toBe(right);
      return true;
    };
    const message = captureFailure(safe);
    const didLeak = message.includes(SECRET) || message.includes(OTHER_SECRET);
    expect(didLeak).toBe(false);
  });

  it('still reports a difference, so the check is no weaker', () => {
    const left = digestOf(OTHER_SECRET);
    const right = digestOf(SECRET);
    expect(left).not.toBe(right);
  });

  it('gives identical content an identical digest', () => {
    const left = digestOf(SECRET);
    const right = digestOf(SECRET);
    expect(left).toBe(right);
  });

  it('never embeds the content it digested', () => {
    const digest = digestOf(SECRET);
    const didEmbed = digest.includes(SECRET);
    expect(didEmbed).toBe(false);
  });

  it('distinguishes absent content from any real digest', () => {
    const digest = digestOf('');
    expect(digest).toBe(ABSENT);
  });

  it('gives present content a digest that is not the absent marker', () => {
    const digest = digestOf(SECRET);
    expect(digest).not.toBe(ABSENT);
  });
});

/**
 * Capture the error code a rejected digest produced.
 * @param target - Path to digest.
 * @returns The `code` of the rejection, or '' when it resolved instead.
 */
async function codeOfRejection(target: string): Promise<string> {
  try {
    await digestFileOrAbsent(target);
  } catch (thrown: unknown) {
    const failure = thrown as NodeJS.ErrnoException;
    return failure.code ?? 'UNKNOWN';
  }
  return '';
}

describe('digesting a file that may not be there', () => {
  let scratch: string;

  beforeAll(async () => {
    const tmp = os.tmpdir();
    const prefix = path.join(tmp, 'secret-digest-');
    scratch = await fs.mkdtemp(prefix);
  });

  afterAll(async () => {
    await fs.rm(scratch, { recursive: true, force: true });
  });

  it('reports absence when there is nothing at the path', async () => {
    const missing = path.join(scratch, 'not-here');
    const digest = await digestFileOrAbsent(missing);
    expect(digest).toBe(ABSENT);
  });

  it('digests the contents when the path does hold something', async () => {
    const target = path.join(scratch, 'present');
    await fs.writeFile(target, SECRET, 'utf8');
    const digest = await digestFileOrAbsent(target);
    const expected = digestOf(SECRET);
    expect(digest).toBe(expected);
  });

  it('refuses to call an unreadable path absent', async () => {
    const code = await codeOfRejection(scratch);
    expect(code).not.toBe('');
    expect(code).not.toBe('ENOENT');
  });
});
