/**
 * Unit tests for Rule #17 — the retired-specifier guard in
 * `src/Tests/Tools/LintValidator.ts`.
 *
 * Split out of `LintAndValidate.test.ts` to keep both files under the
 * file-size cap. The rule earns its own file: it is the guard that keeps a
 * deleted shim deleted, so the forms it does and does not reach are worth
 * stating explicitly rather than burying among the other rules.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';

import { issuesFromCode } from '../../../Tests/Tools/LintValidator.js';

/** Synthetic Pipeline path — forces scope-sensitive rules to fire. */
const SYNTHETIC_PIPELINE = 'src/Scrapers/Pipeline/TestOnly/synthetic.ts';
/** Synthetic non-Pipeline path. */
const SYNTHETIC_OTHER = 'src/Common/synthetic.ts';
/** Synthetic deep test path — the spelling real ApiDirectCall tests used. */
const SYNTHETIC_DEEP_TEST = 'src/Tests/Unit/Pipeline/Mediator/ApiDirectCall/synthetic.test.ts';
// Rule #17 is scoped to whatever the CLI is pointed at; the pre-commit gate
// adds a Rule-#17-only pass over all of `src`, so a Pipeline row and a
// test-tree row both assert a hit — the twenty-seven test importers that had
// to be migrated are where most of the work actually was.
//
// The four spellings below are the ones the ApiDirectCall shim was reached
// through in the real tree. Counting only the '../../Mediator/...' spelling is
// what put the plan's forecast at thirteen importers when there were forty-two.
const RULE_17_CASES = [
  {
    label: 'retired config shim, same-dir spelling',
    file: 'src/Scrapers/Pipeline/Mediator/ApiDirectCall/synthetic.ts',
    code: "import type { IApiDirectCallConfig } from './IApiDirectCallConfig.js';\n",
    expected: 1,
  },
  {
    label: 'type named IApiDirectCallConfig off the canonical barrel',
    file: SYNTHETIC_PIPELINE,
    code: "import type { IApiDirectCallConfig } from '../Mediator/ApiDirectCall/ConfigContracts/index.js';\n",
    expected: 0,
  },
  {
    label: 'live legacy Common/Fetch shim is untouched',
    file: SYNTHETIC_OTHER,
    code: "import { fetchPostWithinPage } from '../../Common/Fetch.js';\n",
    expected: 0,
  },
  {
    label: 'retired config shim, cluster-relative spelling',
    file: SYNTHETIC_PIPELINE,
    code: "import type { IStepConfig } from '../Mediator/ApiDirectCall/IApiDirectCallConfig.js';\n",
    expected: 1,
  },
  {
    label: 'retired config shim, deep test spelling',
    file: SYNTHETIC_DEEP_TEST,
    code: "import type { FlowKind } from '../../../../../Scrapers/Pipeline/Mediator/ApiDirectCall/IApiDirectCallConfig.js';\n",
    expected: 1,
  },
  {
    label: 'retired Fetch shim',
    file: SYNTHETIC_PIPELINE,
    code: "import { fetchPostWithinPage } from '../Mediator/Network/Fetch.js';\n",
    expected: 1,
  },
  {
    label: 'retired AuthDiscovery shim',
    file: SYNTHETIC_PIPELINE,
    code: "import { discoverAuth } from '../Mediator/Network/AuthDiscovery.js';\n",
    expected: 1,
  },
  {
    label: 'retired AuthFailureWatcher shim',
    file: SYNTHETIC_PIPELINE,
    code: "import { watch } from '../Mediator/Network/AuthFailureWatcher.js';\n",
    expected: 1,
  },
  {
    label: 'canonical ConfigContracts barrel',
    file: SYNTHETIC_PIPELINE,
    code: "import type { IStepConfig } from '../Mediator/ApiDirectCall/ConfigContracts/index.js';\n",
    expected: 0,
  },
  {
    label: 'canonical Fetch barrel',
    file: SYNTHETIC_PIPELINE,
    code: "import { fetchPostWithinPage } from '../Mediator/Network/Fetch/index.js';\n",
    expected: 0,
  },
  {
    label: 'canonical AuthDiscovery sub-module',
    file: SYNTHETIC_PIPELINE,
    code: "import { discoverAuth } from '../Mediator/Network/AuthDiscovery/index.js';\n",
    expected: 0,
  },
  {
    label: 'retired shim in a multi-line import',
    file: SYNTHETIC_PIPELINE,
    code: "import {\n  fetchGetWithinPage,\n} from '../Mediator/Network/Fetch.js';\n",
    expected: 1,
  },
  {
    label: 'retired shim as a side-effect import',
    file: SYNTHETIC_PIPELINE,
    code: "import '../Mediator/Network/Fetch.js';\n",
    expected: 1,
  },
  {
    label: 'retired AuthDiscovery as a sibling import',
    file: 'src/Scrapers/Pipeline/Mediator/Network/synthetic.ts',
    code: "import { discoverAuth } from './AuthDiscovery.js';\n",
    expected: 1,
  },
  {
    label: 'retired AuthFailureWatcher one level down',
    file: 'src/Scrapers/Pipeline/Mediator/Network/Fetch/synthetic.ts',
    code: "import { watch } from '../AuthFailureWatcher.js';\n",
    expected: 1,
  },
  {
    label: 'live Common shim re-exporting its own neighbour',
    file: 'src/Common/Fetch.ts',
    code: "export * from './Fetch.js';\n",
    expected: 0,
  },
];

/** The retired modules, as repo-relative runtime specifiers. */
const RETIRED_PATHS: readonly string[] = [
  'src/Scrapers/Pipeline/Mediator/ApiDirectCall/IApiDirectCallConfig.js',
  'src/Scrapers/Pipeline/Mediator/Network/Fetch.js',
  'src/Scrapers/Pipeline/Mediator/Network/AuthDiscovery.js',
  'src/Scrapers/Pipeline/Mediator/Network/AuthFailureWatcher.js',
];

/** Root the Rule #17 replacement paths are written relative to. */
const PIPELINE_ROOT = 'src/Scrapers/Pipeline';

/**
 * Turn a Rule #17 recommendation into the source file it names.
 *
 * Recommendations are runtime specifiers (`.js`) relative to the Pipeline
 * root; on disk the file is the TypeScript source. Only the `.js` → `.ts`
 * mapping is handled, which covers every current row; a future row naming a
 * `.tsx`, a `.mts`, or a bare directory would need this widened, and the
 * caller's `isFile` assertion is what would catch that.
 * @param recommended - Specifier fragment taken from the rule message.
 * @returns Path to the source file the recommendation points at.
 */
function resolveRecommended(recommended: string): string {
  const asSource = recommended.replace(/\.js$/, '.ts');
  const repoRoot = process.cwd();
  return path.join(repoRoot, PIPELINE_ROOT, asSource);
}

/**
 * Whether a path is an existing regular file.
 *
 * `existsSync` alone is not enough: it answers true for a directory, so a
 * recommendation naming a folder rather than a module would pass while failing
 * to resolve at runtime.
 * @param candidate - Absolute path to test.
 * @returns True only for a regular file.
 */
function isRegularFile(candidate: string): boolean {
  if (!fs.existsSync(candidate)) return false;
  const stats = fs.statSync(candidate);
  return stats.isFile();
}

describe('issuesFromCode — Rule #17 retired specifier guard', () => {
  it.each(RULE_17_CASES)('$label → $expected issue(s)', ({ file, code, expected }) => {
    const issues = issuesFromCode(file, code, new Map());
    const r17 = issues.filter((i): boolean => i.rule === 'Rule #17');
    expect(r17).toHaveLength(expected);
  });

  it('names the replacement so the fix is obvious at the failure', () => {
    const code = "import { fetchPostWithinPage } from '../Mediator/Network/Fetch.js';\n";
    const issues = issuesFromCode(SYNTHETIC_PIPELINE, code, new Map());
    const messages = issues
      .filter((i): boolean => i.rule === 'Rule #17')
      .map((i): string => i.message);
    expect(messages).toHaveLength(1);
    expect(messages[0]).toContain('Mediator/Network/Fetch/index.js');
  });

  it('skips its own source but no longer needs to skip its fixtures', () => {
    const code = "import type { X } from './IApiDirectCallConfig.js';\n";
    const validatorDir = 'src/Scrapers/Pipeline/Mediator/ApiDirectCall/synthetic.ts';
    const inValidator = issuesFromCode('src/Tests/Tools/LintValidator.ts', code, new Map());
    const validatorHits = inValidator.filter((i): boolean => i.rule === 'Rule #17');
    expect(validatorHits).toHaveLength(0);

    const fixture = 'const sample = "import { x } from \'./IApiDirectCallConfig.js\';";\n';
    const inFixture = issuesFromCode(validatorDir, fixture, new Map());
    const fixtureHits = inFixture.filter((i): boolean => i.rule === 'Rule #17');
    expect(fixtureHits).toHaveLength(0);

    const real = issuesFromCode(validatorDir, code, new Map());
    const realHits = real.filter((i): boolean => i.rule === 'Rule #17');
    expect(realHits).toHaveLength(1);
  });
  it('ignores a retired path that is prose or data rather than a dependency', () => {
    const prose = ' * The legacy Mediator/Network/Fetch.js shim used to live here.\n';
    const data = "const RETIRED = ['Mediator/Network/Fetch.js'];\n";
    const proseIssues = issuesFromCode(SYNTHETIC_PIPELINE, prose, new Map());
    const dataIssues = issuesFromCode(SYNTHETIC_PIPELINE, data, new Map());
    const proseHits = proseIssues.filter((i): boolean => i.rule === 'Rule #17');
    const dataHits = dataIssues.filter((i): boolean => i.rule === 'Rule #17');
    expect(proseHits).toHaveLength(0);
    expect(dataHits).toHaveLength(0);
  });

  it('still catches a dependency the prose exemption must not cover', () => {
    const dynamic = "const m = await import('../Mediator/Network/Fetch.js');\n";
    const reExport = "export { fetchGetWithinPage } from '../Mediator/Network/Fetch.js';\n";
    const dynamicIssues = issuesFromCode(SYNTHETIC_PIPELINE, dynamic, new Map());
    const reExportIssues = issuesFromCode(SYNTHETIC_PIPELINE, reExport, new Map());
    const dynamicHits = dynamicIssues.filter((i): boolean => i.rule === 'Rule #17');
    const reExportHits = reExportIssues.filter((i): boolean => i.rule === 'Rule #17');
    expect(dynamicHits).toHaveLength(1);
    expect(reExportHits).toHaveLength(1);
  });

  it('catches every static form that creates a dependency', () => {
    const forms: readonly string[] = [
      "export * from '../Mediator/Network/Fetch.js';\n",
      "export * as ns from '../Mediator/Network/Fetch.js';\n",
      "import '../Mediator/Network/Fetch.js';\n",
      "import d from '../Mediator/Network/Fetch.js';\n",
      "import * as n from '../Mediator/Network/Fetch.js';\n",
      "const m = require('../Mediator/Network/Fetch.js');\n",
    ];
    const counts = forms.map((code): number => {
      const issues = issuesFromCode(SYNTHETIC_PIPELINE, code, new Map());
      return issues.filter((i): boolean => i.rule === 'Rule #17').length;
    });
    expect(counts).toEqual([1, 1, 1, 1, 1, 1]);
  });

  it('finds a specifier however deeply it is nested', () => {
    const nested =
      'function a(){ if(true){ try{ void import("../Mediator/Network/Fetch.js"); }catch(error){} } }\n';
    const generic = 'type T = Array<Map<string, import("../Mediator/Network/Fetch.js").Thing>>;\n';
    const nestedHits = issuesFromCode(SYNTHETIC_PIPELINE, nested, new Map()).filter(
      (i): boolean => i.rule === 'Rule #17',
    );
    const genericHits = issuesFromCode(SYNTHETIC_PIPELINE, generic, new Map()).filter(
      (i): boolean => i.rule === 'Rule #17',
    );
    expect(nestedHits).toHaveLength(1);
    expect(genericHits).toHaveLength(1);
  });

  it('resolves a template specifier only when it names one path', () => {
    const fixed = 'const m = await import(`../Mediator/Network/Fetch.js`);\n';
    const interpolated = 'const m = await import(`../Mediator/Network/${name}.js`);\n';
    const fixedHits = issuesFromCode(SYNTHETIC_PIPELINE, fixed, new Map()).filter(
      (i): boolean => i.rule === 'Rule #17',
    );
    const interpolatedHits = issuesFromCode(SYNTHETIC_PIPELINE, interpolated, new Map()).filter(
      (i): boolean => i.rule === 'Rule #17',
    );
    expect(fixedHits).toHaveLength(1);
    expect(interpolatedHits).toHaveLength(0);
  });

  it.each(RETIRED_PATHS)('recommends a path that resolves on disk for %s', retired => {
    const dir = path.posix.dirname(retired);
    const base = path.posix.basename(retired);
    const importer = `${dir}/synthetic.ts`;
    const code = `import { x } from './${base}';\n`;
    const issues = issuesFromCode(importer, code, new Map());
    const hits = issues.filter((i): boolean => i.rule === 'Rule #17');
    expect(hits).toHaveLength(1);
    const recommended = hits[0].message.split(' — use ')[1];
    expect(recommended).toBeDefined();
    const sourcePath = resolveRecommended(recommended);
    const isResolved = isRegularFile(sourcePath);
    expect(isResolved).toBe(true);
  });
});
