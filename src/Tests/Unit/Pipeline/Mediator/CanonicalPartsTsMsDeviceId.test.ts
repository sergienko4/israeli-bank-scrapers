/**
 * Unit tests for the tsMs + deviceId canonical parts.
 *
 * Banks like PayBox sign a canonical string built from two
 * step-instant carry slots (`carry.tsMsSlot` + `carry.deviceId16Hex`).
 * GenericCanonicalStringBuilder dispatches these via PART_RESOLVERS
 * once they are registered (task T11).
 *
 * Test ordering: red-test-first per orientation.txt §3.
 *
 * Reference: spec.txt §4.2 (canonical = `<tsMs>|<deviceId>`).
 */

import ScraperError from '../../../../Scrapers/Base/ScraperError.js';
import type {
  CanonicalPart,
  ICanonicalStringConfig,
} from '../../../../Scrapers/Pipeline/Mediator/ApiDirectCall/IApiDirectCallConfig.js';
import type { Procedure } from '../../../../Scrapers/Pipeline/Types/Procedure.js';

/** Args bundle accepted by buildCanonical — includes new carry slot map. */
interface IBuildArgs {
  readonly canonical: ICanonicalStringConfig;
  readonly pathAndQuery: string;
  readonly bodyJson: string;
  readonly carry?: Readonly<Record<string, unknown>>;
}

/** Module-under-test shape resolved via dynamic import. */
interface IBuilderModule {
  readonly buildCanonical: (args: IBuildArgs) => Procedure<string>;
}

/** Module specifier — lazy load for red-test-first. */
const MODULE_SPECIFIER =
  '../../../../Scrapers/Pipeline/Mediator/ApiDirectCall/Crypto/GenericCanonicalStringBuilder.js';

/**
 * Lazy load GenericCanonicalStringBuilder for the new carry-aware
 * surface introduced by T11.
 * @returns Module with buildCanonical.
 */
async function loadModule(): Promise<IBuilderModule> {
  const mod = (await import(MODULE_SPECIFIER)) as IBuilderModule;
  return mod;
}

/** Reusable canonical config exercising the two new parts. */
const TWO_PARTS_CONFIG: ICanonicalStringConfig = {
  parts: ['tsMs', 'deviceId'] as readonly CanonicalPart[],
  separator: '|',
  escapeFrom: '|',
  escapeTo: String.raw`\|`,
  sortQueryParams: false,
  clientVersion: '1.0.0',
};

describe('GenericCanonicalStringBuilder — tsMs part resolver', () => {
  it('UC-CPT-1: reads carry.tsMsSlot when resolving the tsMs part', async () => {
    const mod = await loadModule();
    const result = mod.buildCanonical({
      canonical: { ...TWO_PARTS_CONFIG, parts: ['tsMs'] as readonly CanonicalPart[] },
      pathAndQuery: '',
      bodyJson: '',
      carry: { tsMsSlot: '1700000000000', deviceId16Hex: 'fixt-deviceid-pb-0001' },
    });
    expect(result.success).toBe(true);
    if (!result.success) throw new ScraperError('buildCanonical must succeed');
    expect(result.value).toBe('1700000000000');
  });
});

describe('GenericCanonicalStringBuilder — deviceId part resolver', () => {
  it('UC-CPT-2: reads carry.deviceId16Hex when resolving the deviceId part', async () => {
    const mod = await loadModule();
    const result = mod.buildCanonical({
      canonical: { ...TWO_PARTS_CONFIG, parts: ['deviceId'] as readonly CanonicalPart[] },
      pathAndQuery: '',
      bodyJson: '',
      carry: { tsMsSlot: '1700000000000', deviceId16Hex: 'fixt-deviceid-pb-0001' },
    });
    expect(result.success).toBe(true);
    if (!result.success) throw new ScraperError('buildCanonical must succeed');
    expect(result.value).toBe('fixt-deviceid-pb-0001');
  });
});

describe('GenericCanonicalStringBuilder — tsMs + deviceId joined', () => {
  it('UC-CPT-3: joins both parts with the configured separator', async () => {
    const mod = await loadModule();
    const result = mod.buildCanonical({
      canonical: TWO_PARTS_CONFIG,
      pathAndQuery: '',
      bodyJson: '',
      carry: { tsMsSlot: '1700000000000', deviceId16Hex: 'fixt-deviceid-pb-0001' },
    });
    expect(result.success).toBe(true);
    if (!result.success) throw new ScraperError('buildCanonical must succeed');
    expect(result.value).toBe('1700000000000|fixt-deviceid-pb-0001');
  });
});
