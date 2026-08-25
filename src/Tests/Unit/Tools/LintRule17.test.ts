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

import { issuesFromCode, RETIRED_SPECIFIERS } from '../../../Tests/Tools/LintValidator.js';

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
    label: 'specifier resolving outside src/ is left alone',
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
    label: 'live Common module re-exporting its own neighbour',
    file: 'src/Common/Browser.ts',
    code: "export * from './Browser.js';\n",
    expected: 0,
  },
];

/**
 * The retired modules, as repo-relative runtime specifiers.
 *
 * Derived from the guard's own registry rather than restated. The hand-kept
 * copy this replaces had drifted to fifteen of seventeen rows, leaving two of
 * the shims guarded by the tool but unasserted by these tests — the exact gap a
 * hand-kept mirror invites.
 */
const RETIRED_PATHS: readonly string[] = [...RETIRED_SPECIFIERS.keys()];

/**
 * The retired modules this suite expects to be guarding, owned by the tests.
 *
 * Deriving the cases above covers a new row automatically, but it cannot notice
 * a row being *removed*: the case simply stops being generated and the suite
 * still passes. Comparing both directions against this list restores that
 * signal — adding or dropping a shim fails here until the list is updated on
 * purpose. Unlike the mirror it replaces, this is asserted rather than used as
 * the only input, so it cannot silently fall behind.
 */
const EXPECTED_RETIRED_INVENTORY: readonly string[] = [
  'src/Common/CamoufoxLauncher.js',
  'src/Common/Config/OtpDetectorConfig.js',
  'src/Common/Debug.js',
  'src/Common/ElementsInteractions.js',
  'src/Common/Fetch.js',
  'src/Common/FormAnchor.js',
  'src/Common/OtpDetector.js',
  'src/Common/SafeScreenshot.js',
  'src/Common/SelectorResolver.js',
  'src/Common/Waiting.js',
  'src/Scrapers/Pipeline/Mediator/ApiDirectCall/IApiDirectCallConfig.js',
  'src/Scrapers/Pipeline/Mediator/Network/AuthDiscovery.js',
  'src/Scrapers/Pipeline/Mediator/Network/AuthFailureWatcher.js',
  'src/Scrapers/Pipeline/Mediator/Network/Fetch.js',
  'src/Scrapers/Pipeline/Mediator/Timing/TimingConfig.js',
  'src/Scrapers/Pipeline/Types/BasePhase.js',
  'src/Scrapers/Pipeline/Types/Debug.js',
];

/**
 * Every Jest API the guard is expected to treat as a module load.
 *
 * Listed here rather than imported from the guard on purpose: deriving it would
 * mean deleting an API from the production set also deletes its test input, so
 * the removal would pass unnoticed — the same trap the retired inventory above
 * exists to close.
 */
const JEST_MODULE_APIS: readonly string[] = [
  'createMockFromModule',
  'deepUnmock',
  'doMock',
  'dontMock',
  'mock',
  'requireActual',
  'requireMock',
  'setMock',
  'unmock',
  'unstable_mockModule',
  'unstable_unmockModule',
];

/**
 * Rows whose replacement is prose rather than one importable path.
 *
 * `TimingConfig.js` split into several per-domain modules, so the correct
 * replacement depends on which constant the caller wanted. These rows are still
 * flagged and still name a replacement; only the resolves-on-disk assertion is
 * inapplicable, so they are partitioned out rather than weakening that check
 * for every other row.
 */
const PROSE_REPLACEMENTS: readonly string[] = [
  'src/Scrapers/Pipeline/Mediator/Timing/TimingConfig.js',
];

/** Rows whose replacement is a single path expected to exist on disk. */
const RESOLVABLE_PATHS: readonly string[] = RETIRED_PATHS.filter(
  (retired): boolean => !PROSE_REPLACEMENTS.includes(retired),
);

/**
 * Rule #17 messages raised by importing a retired module from its own folder.
 *
 * Returns messages rather than issues so the caller needs no issue type, and
 * imports from the sibling directory so the specifier is the shortest spelling
 * that still resolves onto the retired path.
 * @param retired - Repo-relative runtime specifier of a retired module.
 * @returns Every Rule #17 message the import raised.
 */
function retiredMessages(retired: string): readonly string[] {
  const dir = path.posix.dirname(retired);
  const base = path.posix.basename(retired);
  const code = `import { x } from './${base}';\n`;
  const issues = issuesFromCode(`${dir}/synthetic.ts`, code, new Map());
  return issues.filter((i): boolean => i.rule === 'Rule #17').map((i): string => i.message);
}

/**
 * The replacement a Rule #17 message recommends.
 * @param message - A Rule #17 message.
 * @returns The recommended specifier named after the message's separator.
 */
function recommendedFrom(message: string): string {
  const parts = message.split(' — use ');
  return parts[1];
}

/** Root the Rule #17 replacement paths are written relative to. */
const SRC_ROOT = 'src';

/**
 * Turn a Rule #17 recommendation into the source file it names.
 *
 * Recommendations are runtime specifiers (`.js`) relative to `src`; on disk the
 * file is the TypeScript source. Only the `.js` → `.ts` mapping is handled,
 * which covers every current row; a future row naming a `.tsx`, a `.mts`, or a
 * bare directory would need this widened, and the caller's `isFile` assertion
 * is what would catch that.
 * @param recommended - Specifier fragment taken from the rule message.
 * @returns Path to the source file the recommendation points at.
 */
function resolveRecommended(recommended: string): string {
  const asSource = recommended.replace(/\.js$/, '.ts');
  const repoRoot = process.cwd();
  return path.join(repoRoot, SRC_ROOT, asSource);
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

/**
 * The directory a prose recommendation points into.
 *
 * A prose row names a module family (`…/Timing/<Domain>TimingConfig.js`) rather
 * than one file, so the file cannot be resolved — but the folder it lives in
 * can, which is enough to catch the typo the resolve check exists to prevent.
 * @param recommended - Specifier fragment taken from the rule message.
 * @returns Path to the directory named, or an empty string when none is.
 */
function namedDirectory(recommended: string): string {
  const named = /([\w/-]+)\/[\w<>-]+\.js/.exec(recommended);
  if (named === null) return '';
  const repoRoot = process.cwd();
  return path.join(repoRoot, SRC_ROOT, named[1]);
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

  it.each(JEST_MODULE_APIS)('catches a retired path passed to jest.%s', api => {
    const code = `jest.${api}('../Mediator/Network/Fetch.js');\n`;
    const issues = issuesFromCode(SYNTHETIC_PIPELINE, code, new Map());
    const hits = issues.filter((i): boolean => i.rule === 'Rule #17');
    expect(hits).toHaveLength(1);
  });

  it('leaves Jest calls alone when they name no retired module', () => {
    const spy = "const fn = jest.fn('../Mediator/Network/Fetch.js');\n";
    const live = "jest.unstable_mockModule('../Mediator/Network/Fetch/index.js', () => ({}));\n";
    const spyHits = issuesFromCode(SYNTHETIC_PIPELINE, spy, new Map()).filter(
      (i): boolean => i.rule === 'Rule #17',
    );
    const liveHits = issuesFromCode(SYNTHETIC_PIPELINE, live, new Map()).filter(
      (i): boolean => i.rule === 'Rule #17',
    );
    expect(spyHits).toHaveLength(0);
    expect(liveHits).toHaveLength(0);
  });

  it('accounts for every retired specifier exactly once', () => {
    const partitioned = RESOLVABLE_PATHS.length + PROSE_REPLACEMENTS.length;
    expect(partitioned).toBe(RETIRED_PATHS.length);
    const unknownProse = PROSE_REPLACEMENTS.filter(
      (retired): boolean => !RETIRED_PATHS.includes(retired),
    );
    expect(unknownProse).toEqual([]);
  });

  it('guards exactly the inventory of shims these tests expect', () => {
    const guarded = [...RETIRED_PATHS].sort();
    const expected = [...EXPECTED_RETIRED_INVENTORY].sort();
    expect(guarded).toEqual(expected);
  });

  it.each(RETIRED_PATHS)('flags %s when it is imported', retired => {
    const messages = retiredMessages(retired);
    expect(messages).toHaveLength(1);
  });

  it.each(RESOLVABLE_PATHS)('recommends a path that resolves on disk for %s', retired => {
    const messages = retiredMessages(retired);
    const recommended = recommendedFrom(messages[0]);
    expect(recommended).toBeDefined();
    const sourcePath = resolveRecommended(recommended);
    const isResolved = isRegularFile(sourcePath);
    expect(isResolved).toBe(true);
  });

  it.each(PROSE_REPLACEMENTS)('names a real module family for %s', retired => {
    const messages = retiredMessages(retired);
    const recommended = recommendedFrom(messages[0]);
    expect(recommended).toMatch(/\.js\b/);
    const directory = namedDirectory(recommended);
    const isRealDirectory = directory !== '' && fs.existsSync(directory);
    expect(isRealDirectory).toBe(true);
  });
});
