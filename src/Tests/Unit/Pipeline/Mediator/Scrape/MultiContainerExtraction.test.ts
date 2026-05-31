/**
 * Phase 7d — proves the multi-container walker.
 *
 * Contract: when a single response body carries MULTIPLE WK named
 * containers (VisaCal `account/init` shape with both `cards` AND
 * `bankAccounts`), `extractAllContainers` returns every container,
 * `extractAccountRecords` concatenates them, and `extractAccountIds`
 * yields every per-record identifier — proving ACCOUNT-RESOLVE
 * commits the full account graph to `ctx.accountDiscovery` for the
 * downstream SCRAPE phase to consume.
 *
 * Trace fixture: synthesized from the 2026-05-07 manual VisaCal
 * probe with PII fakified (cards renamed FAKE-CARD-AAAA…, bank
 * accounts renamed FAKE-BANK-AAAA…). Real account ids never appear
 * in the suite.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  extractAccountIds,
  extractAccountRecords,
  extractAllContainers,
} from '../../../../../Scrapers/Pipeline/Mediator/Scrape/ScrapeAutoMapper.js';

const HERE_URL = fileURLToPath(import.meta.url);
const HERE = path.dirname(HERE_URL);
const FIXTURE_DIR = path.join(HERE, '..', 'AccountResolve', 'Fixtures');

/**
 * Load a fixture JSON synchronously. Sync IO is fine for test
 * setup — keeps the helper plain and avoids beforeAll plumbing.
 * @param name - Fixture file name.
 * @returns Parsed JSON.
 */
function loadFixture(name: string): Record<string, unknown> {
  const fullPath = path.join(FIXTURE_DIR, name);
  const raw = fs.readFileSync(fullPath, 'utf-8');
  const parsed = JSON.parse(raw) as Record<string, unknown>;
  return parsed;
}

const GOOD_TRACE = loadFixture('visacal-account-init-good.json');
const BAD_EMPTY_CARDS = loadFixture('visacal-account-init-bad-empty-cards.json');
const BAD_MISSING_BANK = loadFixture('visacal-account-init-bad-missing-bankaccounts.json');
const BAD_NO_CONTAINERS = loadFixture('visacal-account-init-bad-no-containers.json');

/**
 * Returns the keys of the supplied container map, sorted via
 * locale-compare so the assertion stays stable across Node
 * implementations (lint rule typescript:S2871 forbids the bare
 * default sort).
 * @param containers - Per-WK container map.
 * @returns Sorted container names.
 */
function sortedContainerKeys(
  containers: Readonly<Record<string, readonly unknown[]>>,
): readonly string[] {
  const keys = Object.keys(containers);
  return keys.sort((a, b): number => a.localeCompare(b));
}

describe('extractAllContainers — Phase 7d multi-container walker', () => {
  it('GOOD trace: surfaces both cards (4) and bankAccounts (3) from a single body', () => {
    const containers = extractAllContainers(GOOD_TRACE);
    const sortedKeys = sortedContainerKeys(containers);
    expect(sortedKeys).toEqual(['bankAccounts', 'cards']);
    expect(containers.cards.length).toBe(4);
    expect(containers.bankAccounts.length).toBe(3);
  });

  it('BAD #1 (missing bankAccounts): surfaces only cards container', () => {
    const containers = extractAllContainers(BAD_MISSING_BANK);
    const sortedKeys = sortedContainerKeys(containers);
    expect(sortedKeys).toEqual(['cards']);
    expect(containers.cards.length).toBe(4);
  });

  it('BAD #2 (empty cards): surfaces only bankAccounts container', () => {
    const containers = extractAllContainers(BAD_EMPTY_CARDS);
    const sortedKeys = sortedContainerKeys(containers);
    expect(sortedKeys).toEqual(['bankAccounts']);
    expect(containers.bankAccounts.length).toBe(3);
  });

  it('BAD #3 (no containers): returns empty object', () => {
    const containers = extractAllContainers(BAD_NO_CONTAINERS);
    expect(containers).toEqual({});
  });
});

describe('extractAccountRecords — Phase 7d concatenation across containers', () => {
  it('GOOD trace: concatenates cards + bankAccounts → 7 records', () => {
    const records = extractAccountRecords(GOOD_TRACE);
    expect(records.length).toBe(7);
  });

  it('BAD #1 (missing bankAccounts): yields only the 4 card records', () => {
    const records = extractAccountRecords(BAD_MISSING_BANK);
    expect(records.length).toBe(4);
  });

  it('BAD #2 (empty cards): yields only the 3 bank account records', () => {
    const records = extractAccountRecords(BAD_EMPTY_CARDS);
    expect(records.length).toBe(3);
  });

  it('BAD #3 (no containers): yields zero records', () => {
    const records = extractAccountRecords(BAD_NO_CONTAINERS);
    expect(records.length).toBe(0);
  });
});

describe('extractAccountIds — Phase 7d ids span all containers', () => {
  it('GOOD trace: 7 distinct ids across cards + bankAccounts', () => {
    const ids = extractAccountIds(GOOD_TRACE);
    expect(ids.length).toBe(7);
    expect(ids).toContain('FAKE-CARD-AAAA-0001');
    expect(ids).toContain('FAKE-CARD-DDDD-0004');
    expect(ids).toContain('FAKE-BANK-AAAA');
    expect(ids).toContain('FAKE-BANK-CCCC');
  });
});
