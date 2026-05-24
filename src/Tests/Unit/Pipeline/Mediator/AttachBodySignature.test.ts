/**
 * Unit tests for the attachBodySignature hook in RunStep — writes a
 * computed signature value (string) into a hydrated outbound body at
 * the configured RFC-6901 JSON pointer (`/signature`,
 * `/auth/signature`, etc.). Required by banks whose request signature
 * is body-attached (e.g. PayBox AES variant).
 *
 * Test ordering: red-test-first per orientation.txt §3. Hook lives in
 * RunStep.ts; T7 commits its implementation alongside this test in
 * the same atomic change so the pre-commit hook's test:pipeline gate
 * stays green.
 *
 * Reference: spec.txt §3.1 (body pointer `/signature`) + §3.4 (body
 * pointer `/auth/signature`).
 */

import ScraperError from '../../../../Scrapers/Base/ScraperError.js';
import type { Procedure } from '../../../../Scrapers/Pipeline/Types/Procedure.js';

/** Args bundle for the attach hook — respects 3-param ceiling. */
interface IAttachBodySignatureArgs {
  readonly body: Record<string, unknown>;
  readonly pointer: string;
  readonly value: string;
}

/** Module-under-test shape resolved via dynamic import. */
interface IRunStepHookModule {
  readonly attachBodySignature: (
    args: IAttachBodySignatureArgs,
  ) => Procedure<Record<string, unknown>>;
}

/** Module specifier — lazy load so missing module fails Jest, not tsc. */
const MODULE_SPECIFIER = '../../../../Scrapers/Pipeline/Mediator/ApiDirectCall/Flow/RunStep.js';

/**
 * Lazily resolve RunStep's exports under test.
 * @returns Module with the hook function.
 */
async function loadModule(): Promise<IRunStepHookModule> {
  const mod = (await import(MODULE_SPECIFIER)) as IRunStepHookModule;
  return mod;
}

describe('attachBodySignature — root pointer', () => {
  it('UC-ABS-1: writes the value at the root /signature pointer', async () => {
    const mod = await loadModule();
    const body = { phoneNum: '972-fixt-phone-pb-0001', isVoiceCall: false } as Record<
      string,
      unknown
    >;
    const result = mod.attachBodySignature({
      body,
      pointer: '/signature',
      value: 'base64sig\n',
    });
    expect(result.success).toBe(true);
    if (!result.success) throw new ScraperError('attachBodySignature must succeed');
    expect(result.value.signature).toBe('base64sig\n');
    expect(result.value.phoneNum).toBe('972-fixt-phone-pb-0001');
    expect(result.value.isVoiceCall).toBe(false);
  });
});

describe('attachBodySignature — nested pointer', () => {
  it('UC-ABS-2: writes the value at the nested /auth/signature pointer', async () => {
    const mod = await loadModule();
    const body = {
      auth: {
        uuid: 'fixt-deviceid-pb-0001',
        uId: 'abcd1234ef567890abcd1234',
        access_token: 'fixt-jwt-pb-0001',
      },
      ts: '0',
    } as Record<string, unknown>;
    const result = mod.attachBodySignature({
      body,
      pointer: '/auth/signature',
      value: 'nested-base64-sig\n',
    });
    expect(result.success).toBe(true);
    if (!result.success) throw new ScraperError('attachBodySignature must succeed');
    const auth = result.value.auth as Record<string, unknown>;
    expect(auth.signature).toBe('nested-base64-sig\n');
    expect(auth.uuid).toBe('fixt-deviceid-pb-0001');
    expect(result.value.ts).toBe('0');
  });
});

describe('attachBodySignature — invalid pointer', () => {
  it('UC-ABS-3: returns Procedure.fail when pointer parent is missing', async () => {
    const mod = await loadModule();
    const body = { iv: '00112233445566778899aabbccddeeff' } as Record<string, unknown>;
    const result = mod.attachBodySignature({
      body,
      pointer: '/missing/signature',
      value: 'whatever',
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.errorMessage).toContain('pointer');
    }
  });

  it('UC-ABS-4: returns Procedure.fail for empty pointer', async () => {
    const mod = await loadModule();
    const body = {} as Record<string, unknown>;
    const result = mod.attachBodySignature({ body, pointer: '', value: 'x' });
    expect(result.success).toBe(false);
  });

  it('UC-ABS-5: returns Procedure.fail when pointer does not start with /', async () => {
    const mod = await loadModule();
    const body = {} as Record<string, unknown>;
    const result = mod.attachBodySignature({ body, pointer: 'signature', value: 'x' });
    expect(result.success).toBe(false);
  });

  it('UC-ABS-6: returns Procedure.fail when pointer ends with /', async () => {
    const mod = await loadModule();
    const body = {} as Record<string, unknown>;
    const result = mod.attachBodySignature({ body, pointer: '/', value: 'x' });
    expect(result.success).toBe(false);
  });

  it('UC-ABS-7: returns Procedure.fail when parent value is an array', async () => {
    const mod = await loadModule();
    const body = { auth: [1, 2, 3] } as Record<string, unknown>;
    const result = mod.attachBodySignature({
      body,
      pointer: '/auth/signature',
      value: 'x',
    });
    expect(result.success).toBe(false);
  });
});
