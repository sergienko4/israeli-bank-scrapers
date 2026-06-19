import { readFileSync } from 'node:fs';

import { runBalanceExtractorWith } from '../../../Scrapers/Pipeline/Mediator/BalanceResolve/BalanceExtractor.js';
import { ACCOUNT_KIND } from '../../../Scrapers/Pipeline/Registry/WK/BalanceKind.js';
import { scopedResolveBalanceAliases } from '../../../Scrapers/Pipeline/Registry/WK/BalanceResolveWK.js';
import type { JsonValue } from '../../../Scrapers/Pipeline/Types/JsonValue.js';
import unwrapWcfForFixture from './unwrapWcfForFixture.js';

/** Expected account balance carried by the representative fixture. */
const EXPECTED_ACCOUNT_BALANCE = 4321.5;

/**
 * Loads a JSON oracle fixture.
 * @param relativePath - Fixture path below this directory.
 * @returns Parsed JSON fixture.
 */
function loadJsonFixture(relativePath: string): JsonValue {
  const raw = readFileSync(new URL(relativePath, import.meta.url), 'utf8');
  return JSON.parse(raw) as JsonValue;
}

describe('Leumi oracle — balance account-family readiness', () => {
  it('unwraps the fixture envelope outside production and resolves the account balance', () => {
    const envelope = loadJsonFixture('fixtures/balance/account-wcf.json');
    const plainBody = unwrapWcfForFixture(envelope);
    const aliases = scopedResolveBalanceAliases(ACCOUNT_KIND);
    const resolved = runBalanceExtractorWith(plainBody, aliases);
    expect(resolved).toBe(EXPECTED_ACCOUNT_BALANCE);
  });
});
