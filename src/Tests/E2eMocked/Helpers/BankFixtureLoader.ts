/**
 * BankFixtureLoader — reads <bankFixtureRoot>/<bank>/fixtures.json
 * + a set of captured HTML files and exposes a route-matching API
 * the OfflineRouteInterceptor uses to serve bytes offline.
 *
 * Zero bank-name branches: everything is data from fixtures.json.
 * New bank = new directory + new fixtures.json entry.
 */

import * as fs from 'node:fs/promises';
import * as path from 'node:path';

import ScraperError from '../../../Scrapers/Base/ScraperError.js';

/** Route table entry — mirrors fixtures.json `routes[i]` shape. */
interface IFixtureRoute {
  readonly method: 'GET' | 'POST' | 'ALL';
  readonly urlGlob: string;
  readonly fixture: string;
  readonly status: number;
}

/** Loaded fixture routes compiled to regexes for URL matching. */
interface ICompiledRoute {
  readonly method: 'GET' | 'POST' | 'ALL';
  readonly pattern: RegExp;
  readonly absolutePath: string;
  readonly status: number;
}

/** Shape of fixtures.json on disk. */
interface IFixturesJson {
  readonly bankKey: string;
  readonly capturedAt: string;
  readonly finalUrl: string;
  readonly routes: readonly IFixtureRoute[];
}

/** Public bank-fixtures handle. */
interface IBankFixtures {
  readonly bankKey: string;
  readonly fixtureRoot: string;
  readonly routes: readonly ICompiledRoute[];
}

/** Args for createBankFixtures — respects the 3-param ceiling. */
interface ICreateArgs {
  readonly bankKey: string;
  readonly fixtureRoot: string;
}

/**
 * Convert a URL glob (`**`, `*`) to a regular expression.
 * Supports `**` (any chars across separators) and `*` (any chars
 * within a single segment).
 * @param glob - URL glob string.
 * @returns Regular expression.
 */
function globToRegex(glob: string): RegExp {
  let re = '';
  let i = 0;
  while (i < glob.length) {
    const ch = glob[i];
    if (ch === '*' && glob[i + 1] === '*') {
      re += '.*';
      i += 2;
      continue;
    }
    if (ch === '*') {
      re += '[^/]*';
      i += 1;
      continue;
    }
    if ('.+?^${}()|[]\\'.includes(ch)) {
      re += `\\${ch}`;
      i += 1;
      continue;
    }
    re += ch;
    i += 1;
  }
  return new RegExp(`^${re}$`);
}

/**
 * Compile a raw fixtures.json entry to a runtime-ready route.
 * @param raw - Raw route from fixtures.json.
 * @param fixtureRoot - Per-bank absolute directory.
 * @returns Compiled route.
 */
function compileRoute(raw: IFixtureRoute, fixtureRoot: string): ICompiledRoute {
  return {
    method: raw.method,
    pattern: globToRegex(raw.urlGlob),
    absolutePath: path.join(fixtureRoot, raw.fixture),
    status: raw.status,
  };
}

/**
 * Load the compiled fixtures for one bank.
 * @param args - Bank-key + fixture-root bundle.
 * @returns IBankFixtures handle with route lookup.
 */
async function createBankFixtures(args: ICreateArgs): Promise<IBankFixtures> {
  const manifestPath = path.join(args.fixtureRoot, 'fixtures.json');
  const raw = await fs.readFile(manifestPath, 'utf8');
  const parsed = JSON.parse(raw) as IFixturesJson;
  if (parsed.bankKey !== args.bankKey) {
    throw new ScraperError(`fixtures.json bankKey mismatch: ${parsed.bankKey} !== ${args.bankKey}`);
  }
  const compiled = parsed.routes.map((r): ICompiledRoute => compileRoute(r, args.fixtureRoot));
  return { bankKey: args.bankKey, fixtureRoot: args.fixtureRoot, routes: compiled };
}

/**
 * Find the first route whose (method, url) matches. Returns false
 * when no route matches — caller treats that as "network escape".
 * @param fixtures - Compiled bank fixtures.
 * @param method - HTTP method.
 * @param url - Full URL.
 * @returns Matched compiled route or false when no route matches.
 */
function findRoute(fixtures: IBankFixtures, method: string, url: string): ICompiledRoute | false {
  const matched = fixtures.routes.find((route): boolean => {
    const isMethodMatch = route.method === 'ALL' || route.method === method;
    if (!isMethodMatch) return false;
    return route.pattern.test(url);
  });
  if (matched === undefined) return false;
  return matched;
}

/**
 * Read the fixture bytes for a compiled route.
 * @param route - Compiled route.
 * @returns UTF-8 file contents.
 */
async function readFixtureBytes(route: ICompiledRoute): Promise<string> {
  return fs.readFile(route.absolutePath, 'utf8');
}

export type { IBankFixtures, ICompiledRoute, IFixtureRoute, IFixturesJson };
export { createBankFixtures, findRoute, globToRegex, readFixtureBytes };
