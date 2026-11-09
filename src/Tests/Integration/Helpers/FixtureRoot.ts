/**
 * Locates the committed bank fixture tree.
 *
 * <p>Fixtures hold captured, PII-redacted bank responses that offline
 * contract tests read from disk. Kept apart from any browser tooling so the
 * fixtures stay reachable after the browser stack is retired.
 */

import * as path from 'node:path';
import * as url from 'node:url';

const FIXTURES_ROOT_REL = 'src/Tests/Integration/fixtures/banks';

/**
 * Resolves the absolute fixture directory of one bank.
 * @param bankId - Bank fixture id, matching the directory name.
 * @returns Absolute path of the bank's fixture directory.
 */
function resolveFixtureRoot(bankId: string): string {
  const here = url.fileURLToPath(new URL('.', import.meta.url));
  const repoRoot = path.resolve(here, '..', '..', '..', '..');
  return path.join(repoRoot, FIXTURES_ROOT_REL, bankId);
}

export default resolveFixtureRoot;
