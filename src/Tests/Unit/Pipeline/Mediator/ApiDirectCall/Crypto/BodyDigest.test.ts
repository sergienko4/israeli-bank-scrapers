/**
 * Golden coverage for the request-body digest header (N30). The expected
 * values were recorded from the bank's reference client for the same body
 * text, so a change to the hash, the prefix join or the encoding fails here.
 */

import type { IBodyDigestConfig } from '../../../../../../Scrapers/Pipeline/Mediator/ApiDirectCall/ConfigContracts/index.js';
import { computeBodyDigest } from '../../../../../../Scrapers/Pipeline/Mediator/ApiDirectCall/Crypto/BodyDigest.js';
import { serializeJsonBody } from '../../../../../../Scrapers/Pipeline/Strategy/Fetch/JsonBody.js';

const BD_IDENT_KEY: IBodyDigestConfig = {
  header: 'BD_IDENT_KEY',
  prefix: 'BaNCSDigitalApps.Android_1.0.0.BY.1.0.212~GDM_1.0.81~MessageEnvelope_1.0.0~',
  hash: 'sha256-hex',
  encode: 'base64',
};

/** One recorded body and the header the reference client sent for it. */
interface IDigestGolden {
  readonly name: string;
  readonly body: Readonly<Record<string, string>>;
  readonly header: string;
}

const GOLDENS: readonly IDigestGolden[] = [
  {
    name: 'an empty object',
    body: {},
    header:
      'QmFOQ1NEaWdpdGFsQXBwcy5BbmRyb2lkXzEuMC4wLkJZLjEuMC4yMTJ+R0RNXzEuMC44MX5NZXNzYWdlRW52ZWxvcGVfMS4wLjB+' +
      'NDQxMzZmYTM1NWIzNjc4YTExNDZhZDE2ZjdlODY0OWU5NGZiNGZjMjFmZTc3ZTgzMTBjMDYwZjYxY2FhZmY4YQ==',
  },
  {
    name: 'a Hebrew value',
    body: { a: 'ש' },
    header:
      'QmFOQ1NEaWdpdGFsQXBwcy5BbmRyb2lkXzEuMC4wLkJZLjEuMC4yMTJ+R0RNXzEuMC44MX5NZXNzYWdlRW52ZWxvcGVfMS4wLjB+' +
      'ZmNjNzQ2Zjc2Yjc2MDA3ODNkMjNjOTliNzg4Zjg4YWU3ODRhZDJkMjgxYmI1ODMxYzI4NTU0NTZjZWUzMWU5Mw==',
  },
];

describe('BodyDigest/reference goldens', () => {
  it.each(GOLDENS)('matches the recorded header for $name', golden => {
    const serialized = serializeJsonBody(golden.body);
    const digest = computeBodyDigest(serialized.bytes, BD_IDENT_KEY);
    expect(digest).toBe(golden.header);
  });
});
