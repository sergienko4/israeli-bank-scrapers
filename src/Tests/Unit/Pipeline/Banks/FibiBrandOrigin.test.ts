/**
 * FIBI sibling characterization — each brand's scrape shape must target the
 * same origin its login transport authenticated against. A drift between the
 * two would send the session cookies of one host to another, so the family
 * factory binds both from the same registry brand record.
 *
 * The config modules load dynamically per the project's Banks-test rule.
 */

import beinleumiShape from '../../../../Scrapers/Pipeline/Banks/Beinleumi/scrape/BeinleumiShape.js';
import massadShape from '../../../../Scrapers/Pipeline/Banks/Massad/scrape/MassadShape.js';
import otsarShape from '../../../../Scrapers/Pipeline/Banks/OtsarHahayal/scrape/OtsarHahayalShape.js';
import pagiShape from '../../../../Scrapers/Pipeline/Banks/Pagi/scrape/PagiShape.js';
import type { IApiDirectScrapeShape } from '../../../../Scrapers/Pipeline/Phases/ApiDirectScrape/IApiDirectScrapeShape.js';
import type { IActionContext } from '../../../../Scrapers/Pipeline/Types/PipelineContext.js';

/** The transport slice this probe reads. */
interface ITransportProbe {
  readonly identityBase: string;
}

/** One brand: its shape and the loader for its login transport. */
interface IBrandProbe {
  readonly name: string;
  readonly shape: IApiDirectScrapeShape<unknown, never>;
  readonly loadBase: () => Promise<string>;
}

/** Context a URL producer may read (no fields this probe needs). */
const CTX = { options: { startDate: new Date(0) } } as unknown as IActionContext;

/**
 * Read a URL tag, invoking a producer when the shape declares one.
 * @param tag - Literal URL or producer.
 * @param args - Arguments the producer expects.
 * @returns The resolved URL text.
 */
function urlOf(tag: unknown, ...args: readonly unknown[]): string {
  if (typeof tag === 'function') return (tag as (...a: readonly unknown[]) => string)(...args);
  return typeof tag === 'string' ? tag : '';
}

const BRANDS: readonly IBrandProbe[] = [
  {
    name: 'Beinleumi',
    shape: beinleumiShape as IApiDirectScrapeShape<unknown, never>,
    /**
     * Load the Beinleumi login transport.
     * @returns The transport's identity base.
     */
    loadBase: async (): Promise<string> => {
      const mod =
        (await import('../../../../Scrapers/Pipeline/Registry/Config/PipelineBankConfigBeinleumi.js')) as {
          readonly BEINLEUMI_TRANSPORT: ITransportProbe;
        };
      return mod.BEINLEUMI_TRANSPORT.identityBase;
    },
  },
  {
    name: 'Massad',
    shape: massadShape as IApiDirectScrapeShape<unknown, never>,
    /**
     * Load the Massad login transport.
     * @returns The transport's identity base.
     */
    loadBase: async (): Promise<string> => {
      const mod =
        (await import('../../../../Scrapers/Pipeline/Registry/Config/PipelineBankConfigMassad.js')) as {
          readonly MASSAD_TRANSPORT: ITransportProbe;
        };
      return mod.MASSAD_TRANSPORT.identityBase;
    },
  },
  {
    name: 'OtsarHahayal',
    shape: otsarShape as IApiDirectScrapeShape<unknown, never>,
    /**
     * Load the OtsarHahayal login transport.
     * @returns The transport's identity base.
     */
    loadBase: async (): Promise<string> => {
      const mod =
        (await import('../../../../Scrapers/Pipeline/Registry/Config/PipelineBankConfigOtsarHahayal.js')) as {
          readonly OTSAR_HAHAYAL_TRANSPORT: ITransportProbe;
        };
      return mod.OTSAR_HAHAYAL_TRANSPORT.identityBase;
    },
  },
  {
    name: 'Pagi',
    shape: pagiShape as IApiDirectScrapeShape<unknown, never>,
    /**
     * Load the Pagi login transport.
     * @returns The transport's identity base.
     */
    loadBase: async (): Promise<string> => {
      const mod =
        (await import('../../../../Scrapers/Pipeline/Registry/Config/PipelineBankConfigPagi.js')) as {
          readonly PAGI_TRANSPORT: ITransportProbe;
        };
      return mod.PAGI_TRANSPORT.identityBase;
    },
  },
];

describe.each(BRANDS)('$name FIBI brand origin', brand => {
  it('binds the scrape URLs to the login transport origin', async () => {
    const base = await brand.loadBase();
    const customerUrl = urlOf(brand.shape.customer.urlTag, CTX);
    const txnsUrl = urlOf(brand.shape.transactions.urlTag, {}, false, CTX);
    const isCustomerOnBase = customerUrl.startsWith(base);
    const isTxnsOnBase = txnsUrl.startsWith(base);
    expect(isCustomerOnBase).toBe(true);
    expect(isTxnsOnBase).toBe(true);
  });
});
