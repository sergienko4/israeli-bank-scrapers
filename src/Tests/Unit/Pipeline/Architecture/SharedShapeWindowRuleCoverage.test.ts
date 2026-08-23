/**
 * Guards the §20 window-end lock against a silent loss of coverage when a
 * bank family's transactions shape moves out of its bank folder.
 *
 * <p>The rule that forbids reading the clock in a `*ShapeTxns.ts` file is
 * path-keyed. It was originally scoped to the per-bank `scrape/` folders, so
 * extracting the FIBI group's shared transactions module into
 * `Phases/ApiDirectScrape/FibiGroup/` would have dropped the guardrail exactly
 * where four banks came to depend on it at once — with no test failing. The
 * glob was widened; this test is what notices if it is ever narrowed back.
 *
 * <p>It asserts coverage in both directions: the shared factory and a per-bank
 * shape are armed, while OneZero (a documented exclusion — it is
 * `providerCursor` and has no upper bound to narrow) and a non-transactions
 * module in the same folder are not. Asserting the negatives is what keeps a
 * lazy "match everything" glob from passing this test. Because a missing file
 * also resolves to "not armed", every probe target is checked for existence
 * first — otherwise renaming one would silently turn its assertion into a
 * tautology.
 */

import { existsSync } from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

import { ESLint } from 'eslint';

const HERE_URL = fileURLToPath(import.meta.url);
const HERE = path.dirname(HERE_URL);
const PIPELINE_ROOT = path.join(HERE, '..', '..', '..', '..', 'Scrapers', 'Pipeline');
const FIBI_GROUP = path.join(PIPELINE_ROOT, 'Phases', 'ApiDirectScrape', 'FibiGroup');
const BANKS = path.join(PIPELINE_ROOT, 'Banks');

/** Stable fragment of the rule's message — cheaper to match than its selector. */
const WINDOW_RULE_MARKER = 'detaches it from the scrape window';

const CASES = {
  'shared FIBI transactions factory': path.join(FIBI_GROUP, 'FibiGroupShapeTxns.ts'),
  'per-bank transactions shape': path.join(BANKS, 'Massad', 'scrape', 'MassadShapeTxns.ts'),
  'OneZero (documented exclusion)': path.join(BANKS, 'OneZero', 'scrape', 'OneZeroShapeTxns.ts'),
  'non-transactions module beside the factory': path.join(FIBI_GROUP, 'FibiGroupShape.ts'),
} as const;

const EXPECTED = {
  'shared FIBI transactions factory': true,
  'per-bank transactions shape': true,
  'OneZero (documented exclusion)': false,
  'non-transactions module beside the factory': false,
} as const;

type CaseLabel = keyof typeof CASES;

/** Every probe target must exist — see `probePresence` for why that matters. */
const PRESENT_PAIRS = Object.keys(CASES).map((l): readonly [string, boolean] => [l, true]);
const ALL_PRESENT: Readonly<Record<string, boolean>> = Object.fromEntries(PRESENT_PAIRS);

/** Shape of the resolved flat config this test reads — ESLint types it as `any`. */
interface IResolvedConfig {
  readonly rules?: Readonly<Record<string, unknown>>;
}

/**
 * Maps every probe target to whether it exists on disk.
 *
 * <p>Two of the four cases assert `false`. A renamed or deleted probe file
 * resolves to `false` as well, so those assertions would keep passing while
 * guarding nothing. Existence is therefore asserted separately, as part of the
 * contract rather than an assumption.
 * @param labels - The `CASES` keys to check.
 * @returns Each label mapped to whether its probe file exists on disk.
 */
function probePresence(labels: readonly CaseLabel[]): Record<string, boolean> {
  const pairs = labels.map((l): readonly [string, boolean] => [l, existsSync(CASES[l])]);
  return Object.fromEntries(pairs);
}

/**
 * Reports whether the window-end rule is configured for one file.
 * @param engine - A shared ESLint instance (config resolution is expensive).
 * @param file - Absolute path of the file to resolve config for.
 * @returns True when `no-restricted-syntax` carries the window-end rule.
 */
async function isWindowRuleArmed(engine: ESLint, file: string): Promise<boolean> {
  const resolved = (await engine.calculateConfigForFile(file)) as IResolvedConfig | undefined;
  const rule = resolved?.rules?.['no-restricted-syntax'] ?? null;
  return JSON.stringify(rule).includes(WINDOW_RULE_MARKER);
}

describe('§20 window-end lock — path coverage', () => {
  it('arms the rule on every transactions shape, and only there', async () => {
    const engine = new ESLint();
    const labels = Object.keys(CASES) as readonly CaseLabel[];
    const present = probePresence(labels);
    expect(present).toEqual(ALL_PRESENT);
    const probes = labels.map((l): Promise<boolean> => isWindowRuleArmed(engine, CASES[l]));
    const armed = await Promise.all(probes);
    const pairs = labels.map((l, i): readonly [string, boolean] => [l, armed[i] ?? false]);
    const actual = Object.fromEntries(pairs);
    expect(actual).toEqual(EXPECTED);
  }, 60_000);
});
