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
 * lazy "match everything" glob from passing this test.
 */

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

/** Shape of the resolved flat config this test reads — ESLint types it as `any`. */
interface IResolvedConfig {
  readonly rules?: Readonly<Record<string, unknown>>;
}

/**
 * Reports whether the window-end rule is configured for one file.
 * @param engine - A shared ESLint instance (config resolution is expensive).
 * @param file - Absolute path of the file to resolve config for.
 * @returns True when `no-restricted-syntax` carries the window-end rule.
 */
async function isWindowRuleArmed(engine: ESLint, file: string): Promise<boolean> {
  const resolved = (await engine.calculateConfigForFile(file)) as IResolvedConfig;
  const rule = resolved.rules?.['no-restricted-syntax'] ?? null;
  const restricted = JSON.stringify(rule);
  return restricted.includes(WINDOW_RULE_MARKER);
}

describe('§20 window-end lock — path coverage', () => {
  it('arms the rule on every transactions shape, and only there', async () => {
    const engine = new ESLint();
    const labels = Object.keys(CASES) as readonly (keyof typeof CASES)[];
    const probes = labels.map((l): Promise<boolean> => isWindowRuleArmed(engine, CASES[l]));
    const armed = await Promise.all(probes);
    const pairs = labels.map((l, i): readonly [string, boolean] => [l, armed[i] ?? false]);
    const actual = Object.fromEntries(pairs);
    expect(actual).toEqual(EXPECTED);
  }, 60_000);
});
