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

describe('consumer install smoke isolation', () => {
  it('uses a synthetic HTTP response and restores fetch without reaching the network', async () => {
    const original = globalThis.fetch;
    const network = jest.fn(() => Promise.resolve(new Response(null, { status: 599 })));
    const log = jest.spyOn(console, 'log').mockImplementation(() => undefined);
    let status = 0;
    const scrape = jest.fn(async () => {
      status = (await fetch('https://bank.example')).status;
      return { success: false };
    });
    const createScraper = jest.fn(() => ({ scrape }));
    globalThis.fetch = network;
    try {
      await SMOKE.runScrape({
        CompanyTypes: { Leumi: 'leumi' },
        createScraper,
      });
      expect(status).toBe(503);
      expect(network).not.toHaveBeenCalled();
      expect(globalThis.fetch).toBe(network);
    } finally {
      globalThis.fetch = original;
      log.mockRestore();
    }
  });

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
