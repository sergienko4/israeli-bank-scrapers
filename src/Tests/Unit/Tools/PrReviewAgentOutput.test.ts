/**
 * Unit tests for the GitHub Actions outputs written by the review poster.
 */

import { mkdir, mkdtemp, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';

import { markCreated, markFindings } from '../../../../.github/scripts/pr-review/post-review.mjs';

describe('PR review workflow outputs', () => {
  it('records creation and finding count for the workflow', async () => {
    await mkdir('.review', { recursive: true });
    const tempPrefix = join('.review', 'pr-review-output-');
    const dir = await mkdtemp(tempPrefix);
    const output = join(dir, 'output');
    const previous = process.env.GITHUB_OUTPUT;
    process.env.GITHUB_OUTPUT = output;
    try {
      await markCreated();
      await markFindings(3);
      expect(await readFile(output, 'utf8')).toBe('created=true\nfindings=3\n');
    } finally {
      delete process.env.GITHUB_OUTPUT;
      if (previous !== undefined) process.env.GITHUB_OUTPUT = previous;
      await rm(dir, { recursive: true, force: true });
    }
  });
});
