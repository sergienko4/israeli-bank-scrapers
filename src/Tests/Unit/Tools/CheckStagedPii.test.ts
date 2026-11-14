/**
 * The staged-PII guard scans the index in the hook and a pull request range
 * in CI.
 *
 * <p>The hook sees only what is staged, so a commit made with the hook
 * skipped reaches CI unchecked unless the same scan can read a range. These
 * cases pin both modes and the refusal of a base that is not a commit id,
 * which would otherwise be handed to `git` as an option.
 */

import { createHash } from 'node:crypto';

import { diffArgs, findOffendingFiles } from '../../../../scripts/check-staged-pii.cjs';

/** A synthetic value standing in for a denylisted real one. */
const FAKE_SECRET = 'synthetic-denylisted-value-0000';

/** The denylist holding only the synthetic value's digest. */
const DENY: ReadonlySet<string> = new Set([createHash('sha256').update(FAKE_SECRET).digest('hex')]);

/**
 * A one-file unified diff that adds a single line.
 * @param file - Path shown in the `+++ b/` header.
 * @param added - The added line's text.
 * @returns The diff text.
 */
function oneLineDiff(file: string, added: string): string {
  return [`--- a/${file}`, `+++ b/${file}`, '@@ -0,0 +1 @@', `+${added}`].join('\n');
}

describe('check-staged-pii — diff scope', () => {
  it('[PII-1] scans the staged index when no base is given', () => {
    const args = diffArgs('');
    expect(args).toEqual(['diff', '--cached', '--unified=0']);
  });

  it('[PII-2] scans the pull request range when a base commit is given', () => {
    const args = diffArgs('84ec2ddd');
    expect(args).toEqual(['diff', '--unified=0', '84ec2ddd...HEAD']);
  });

  it.each(['--output=/tmp/x', 'main', '84ec2ddd; rm -rf /'])(
    '[PII-3] refuses a base that is not a commit id: %s',
    base => {
      const args = diffArgs(base);
      expect(args).toBeNull();
    },
  );
});

describe('check-staged-pii — detection', () => {
  it('[PII-4] reports a file whose added line carries a denylisted value', () => {
    const diff = oneLineDiff('src/a.test.ts', `const card = '${FAKE_SECRET}';`);
    const offending = findOffendingFiles(DENY, diff);
    expect(offending).toEqual(['src/a.test.ts']);
  });

  it('[PII-5] ignores a removed line and an unrelated value', () => {
    const removed = `-const card = '${FAKE_SECRET}';`;
    const diff = `${oneLineDiff('src/b.test.ts', "const card = 'fake-value-1111';")}\n${removed}`;
    const offending = findOffendingFiles(DENY, diff);
    expect(offending).toEqual([]);
  });
});
