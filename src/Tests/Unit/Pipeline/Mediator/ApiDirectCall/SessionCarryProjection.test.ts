/**
 * The carry snapshot a login hands to the scrape is projected through
 * the flow's `sessionCarry` allowlist; without one the full snapshot passes.
 */

import type { JsonValue } from '../../../../../Scrapers/Pipeline/Mediator/ApiDirectCall/Envelope/JsonPointer.js';
import { projectSessionCarry } from '../../../../../Scrapers/Pipeline/Mediator/ApiDirectCall/SessionCarryProjection.js';

const CARRY: Readonly<Record<string, JsonValue>> = {
  mag: 'mag-value',
  certKeyPem: 'key-pem',
  clientSecret: 'client-secret',
  token: 'access-token',
};

describe('projectSessionCarry', () => {
  it('passes the full snapshot when no allowlist is configured', () => {
    const projected = projectSessionCarry(CARRY);
    expect(projected).toEqual(CARRY);
  });

  it('keeps exactly the allowlisted slots', () => {
    const projected = projectSessionCarry(CARRY, ['mag']);
    expect(projected).toEqual({ mag: 'mag-value' });
  });

  it('omits an allowlisted slot the carry does not hold', () => {
    const projected = projectSessionCarry(CARRY, ['mag', 'csrf']);
    expect(projected).toEqual({ mag: 'mag-value' });
  });

  it('an empty allowlist hands nothing to the scrape', () => {
    const projected = projectSessionCarry(CARRY, []);
    expect(projected).toEqual({});
  });
});
