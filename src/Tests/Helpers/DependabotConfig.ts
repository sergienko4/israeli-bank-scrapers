/**
 * DependabotConfig — the npm groups `.github/dependabot.yml` declares.
 *
 * <p>Shared by the Dependabot wiring tests, so each reads the file the same
 * way and none re-implements the lookup.
 */

import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { parse } from 'yaml';

const THIS_FILE_PATH = fileURLToPath(import.meta.url);
const THIS_DIR = dirname(THIS_FILE_PATH);
const REPO_ROOT = join(THIS_DIR, '../../../');
const DEPENDABOT_YAML = join(REPO_ROOT, '.github/dependabot.yml');

interface IDependabotGroup {
  /** YAML parses an empty `applies-to:` value as null, not as absent. */
  readonly 'applies-to'?: string | null;
  readonly patterns?: readonly string[];
  readonly 'exclude-patterns'?: readonly string[];
  readonly 'dependency-type'?: string;
  readonly 'update-types'?: readonly string[];
}

interface IDependabotUpdate {
  readonly 'package-ecosystem': string;
  readonly directory: string;
  readonly groups?: Readonly<Record<string, IDependabotGroup>>;
}

interface IDependabotDoc {
  readonly updates?: readonly IDependabotUpdate[];
}

/**
 * Parse the Dependabot configuration.
 *
 * @returns Parsed document, or an empty document when the file is absent.
 */
function loadDependabot(): IDependabotDoc {
  if (!existsSync(DEPENDABOT_YAML)) {
    return {};
  }
  const raw = readFileSync(DEPENDABOT_YAML, 'utf8');
  return parse(raw) as IDependabotDoc;
}

/**
 * Groups declared on the root npm entry, keyed by group name.
 *
 * @returns Every npm group, or an empty map when the entry is missing.
 */
function npmGroupMap(): Readonly<Record<string, IDependabotGroup>> {
  const updates = loadDependabot().updates ?? [];
  const npm = updates.find(item => item['package-ecosystem'] === 'npm' && item.directory === '/');
  return npm?.groups ?? {};
}

export type { IDependabotGroup };
export { npmGroupMap };
