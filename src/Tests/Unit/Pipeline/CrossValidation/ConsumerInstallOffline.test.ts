import { createRequire } from 'node:module';

import { jest } from '@jest/globals';

interface IConsumerExports {
  readonly CompanyTypes: { readonly Leumi: string };
  readonly createScraper: () => {
    readonly scrape: () => Promise<{ readonly success: boolean }>;
  };
}

interface ISmoke {
  readonly runScrape: (exports: IConsumerExports) => Promise<void>;
}

const SMOKE = createRequire(import.meta.url)(
  '../../../../../.github/scripts/ci/consumer-smoke.cjs',
) as ISmoke;
const PRIME_URL = 'https://hb2.bankleumi.co.il/H/Login.html';

describe('consumer install smoke isolation', () => {
  it.each([
    ['string', PRIME_URL],
    ['URL', new URL(PRIME_URL)],
    ['Request', new Request(PRIME_URL)],
  ] as const)('uses a synthetic response for a %s and restores fetch', async (_kind, input) => {
    const original = globalThis.fetch;
    const network = jest.fn(() => Promise.resolve(new Response(null, { status: 599 })));
    const log = jest.spyOn(console, 'log').mockImplementation(() => undefined);
    let status = 0;
    const scrape = jest.fn(async () => {
      status = (await fetch(input)).status;
      return { success: false };
    });
    const createScraper = jest.fn(() => ({ scrape }));
    globalThis.fetch = network;
    try {
      await SMOKE.runScrape({
        CompanyTypes: { Leumi: 'leumi' },
        createScraper,
      });
      expect(createScraper).toHaveBeenCalledWith({
        companyId: 'leumi',
        startDate: new Date('2026-01-01'),
      });
      expect(status).toBe(503);
      expect(network).not.toHaveBeenCalled();
      expect(globalThis.fetch).toBe(network);
    } finally {
      globalThis.fetch = original;
      log.mockRestore();
    }
  });

  it.each(['https://hb2.bankleumi.co.il/H/Wrong.html', 'https://bank.example/H/Login.html'])(
    'rejects an unexpected prime URL without network access: %s',
    async url => {
      const original = globalThis.fetch;
      const exitCode = process.exitCode;
      const network = jest.fn(() => Promise.resolve(new Response(null, { status: 599 })));
      const log = jest.spyOn(console, 'log').mockImplementation(() => undefined);
      const scrape = jest.fn(async () => {
        await fetch(url);
        return { success: false };
      });
      globalThis.fetch = network;
      try {
        await SMOKE.runScrape({
          CompanyTypes: { Leumi: 'leumi' },
          createScraper: jest.fn(() => ({ scrape })),
        });
        expect(process.exitCode).toBe(1);
        expect(log).toHaveBeenCalledWith('SETTLED throw Unexpected consumer prime URL');
        expect(log).not.toHaveBeenCalledWith('OFFLINE_REQUEST');
        expect(network).not.toHaveBeenCalled();
        expect(globalThis.fetch).toBe(network);
      } finally {
        globalThis.fetch = original;
        process.exitCode = exitCode;
        log.mockRestore();
      }
    },
  );

  it('restores fetch and reports a synchronous factory failure', async () => {
    const original = globalThis.fetch;
    const exitCode = process.exitCode;
    const log = jest.spyOn(console, 'log').mockImplementation(() => undefined);
    try {
      await SMOKE.runScrape({
        CompanyTypes: { Leumi: 'leumi' },
        createScraper: jest.fn(() => {
          throw new TypeError('synthetic factory failure');
        }),
      });
      expect(globalThis.fetch).toBe(original);
      expect(process.exitCode).toBe(1);
      expect(log).toHaveBeenCalledWith('SETTLED throw synthetic factory failure');
    } finally {
      globalThis.fetch = original;
      process.exitCode = exitCode;
      log.mockRestore();
    }
  });
});
