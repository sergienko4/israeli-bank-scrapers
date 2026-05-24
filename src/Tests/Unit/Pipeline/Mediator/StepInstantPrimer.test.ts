/**
 * Unit tests for the step-instant primer + slot-aware nowMs resolver.
 *
 * The primer samples Date.now ONCE per step entry and writes it to
 * carry.tsMsSlot so all downstream consumers (canonical-string parts,
 * body $ref:'nowMs', mediator signature) see the SAME millisecond.
 * Without this, body hydrate + canonical build sample different
 * Date.now() values and the server-side signature comparison fails.
 *
 * Test ordering: red-test-first per orientation.txt §3.
 *
 * Reference: spec.txt §4.2 (tsMsString in canonical) + §3.1 hydrate
 *            order.
 */

import ScraperError from '../../../../Scrapers/Base/ScraperError.js';
import type { Procedure } from '../../../../Scrapers/Pipeline/Types/Procedure.js';

/** Args bundle for the primer — respects 3-param ceiling. */
interface IPrimerArgs {
  readonly carry: Readonly<Record<string, unknown>>;
}

/** RunStep export shape under test for the primer. */
interface IPrimerModule {
  readonly primeStepInstant: (args: IPrimerArgs) => Procedure<Readonly<Record<string, unknown>>>;
}

/** Module specifier — lazy load for red-test-first. */
const MODULE_SPECIFIER = '../../../../Scrapers/Pipeline/Mediator/ApiDirectCall/Flow/RunStep.js';

/**
 * Lazy load the primer from RunStep.
 * @returns Module exposing the primer.
 */
async function loadModule(): Promise<IPrimerModule> {
  const mod = (await import(MODULE_SPECIFIER)) as IPrimerModule;
  return mod;
}

describe('primeStepInstant — samples Date.now once per step entry', () => {
  it('UC-SIP-1: writes Date.now() to carry.tsMsSlot when missing', async () => {
    const mod = await loadModule();
    const result = mod.primeStepInstant({ carry: {} });
    expect(result.success).toBe(true);
    if (!result.success) throw new ScraperError('primeStepInstant must succeed');
    expect(typeof result.value.tsMsSlot).toBe('string');
    const slotValue = result.value.tsMsSlot;
    const ts = Number(slotValue);
    const isFiniteTs = Number.isFinite(ts);
    expect(isFiniteTs).toBe(true);
    expect(ts).toBeGreaterThan(0);
  });
});

describe('primeStepInstant — idempotent within a single step entry', () => {
  it('UC-SIP-2: preserves an existing carry.tsMsSlot rather than resampling', async () => {
    const mod = await loadModule();
    const result = mod.primeStepInstant({ carry: { tsMsSlot: '1700000000000' } });
    expect(result.success).toBe(true);
    if (!result.success) throw new ScraperError('primeStepInstant must succeed');
    expect(result.value.tsMsSlot).toBe('1700000000000');
  });
});

describe('primeStepInstant — defensive branches', () => {
  it('UC-SIP-4: treats empty-string tsMsSlot as missing and resamples', async () => {
    const mod = await loadModule();
    const result = mod.primeStepInstant({ carry: { tsMsSlot: '' } });
    expect(result.success).toBe(true);
    if (!result.success) throw new ScraperError('primeStepInstant must succeed');
    expect(typeof result.value.tsMsSlot).toBe('string');
    expect((result.value.tsMsSlot as string).length).toBeGreaterThan(0);
  });
});

describe('RefResolver.handleNowMs — fallback fresh Date.now', () => {
  it('UC-SIP-5: returns fresh Date.now() when carry.tsMsSlot is absent', async () => {
    const { hydrate } =
      await import('../../../../Scrapers/Pipeline/Mediator/ApiDirectCall/Template/GenericBodyTemplate.js');
    const config = {
      flow: 'sms-otp' as const,
      envelope: {},
      probe: {},
      steps: [],
    };
    const before = Date.now();
    const out = hydrate({ $ref: 'nowMs' as const }, { carry: {}, creds: {}, config });
    const after = Date.now();
    expect(out.success).toBe(true);
    if (!out.success) throw new ScraperError('hydrate must succeed');
    const ts = out.value as number;
    expect(ts).toBeGreaterThanOrEqual(before);
    expect(ts).toBeLessThanOrEqual(after);
  });

  it('UC-SIP-6: returns fresh Date.now() when tsMsSlot is non-numeric', async () => {
    const { hydrate } =
      await import('../../../../Scrapers/Pipeline/Mediator/ApiDirectCall/Template/GenericBodyTemplate.js');
    const config = {
      flow: 'sms-otp' as const,
      envelope: {},
      probe: {},
      steps: [],
    };
    const before = Date.now();
    const out = hydrate(
      { $ref: 'nowMs' as const },
      { carry: { tsMsSlot: 'not-a-number' }, creds: {}, config },
    );
    const after = Date.now();
    expect(out.success).toBe(true);
    if (!out.success) throw new ScraperError('hydrate must succeed');
    const ts = out.value as number;
    expect(ts).toBeGreaterThanOrEqual(before);
    expect(ts).toBeLessThanOrEqual(after);
  });
});

describe('RefResolver.handleNowMs — slot-aware sampling', () => {
  it('UC-SIP-3: returns carry.tsMsSlot value when populated, else fresh Date.now', async () => {
    const { hydrate } =
      await import('../../../../Scrapers/Pipeline/Mediator/ApiDirectCall/Template/GenericBodyTemplate.js');
    const config = {
      flow: 'sms-otp' as const,
      envelope: {},
      probe: {},
      steps: [],
    };
    const out = hydrate(
      { $ref: 'nowMs' as const },
      {
        carry: { tsMsSlot: '1700000000000' },
        creds: {},
        config,
      },
    );
    expect(out.success).toBe(true);
    if (!out.success) throw new ScraperError('hydrate must succeed for slot-aware nowMs');
    // Slot-aware: hydrate returns the carry slot value when populated.
    expect(out.value).toBe(1700000000000);
  });
});
