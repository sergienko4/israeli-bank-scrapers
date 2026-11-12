/**
 * Beinleumi group siblings — each sibling's api-direct login is Beinleumi's
 * with its brand swapped in: the online host, portal id, Transmit app id,
 * bank number and device-memory provider. Nothing else may differ, so the
 * Beinleumi config suites prove every sibling's flow, and a brand value the
 * family builders fail to thread through leaves a Beinleumi literal behind
 * and fails here. Each brand is copied from the protocol, never read from
 * the config under test.
 *
 * Uses dynamic imports for `Registry/Config/*` per the project's test rule
 * (Pipeline tests don't statically import from Registry/Config).
 */

import { CompanyTypes } from '../../../../../Definitions.js';
import type { IApiDirectRuleInput } from '../../../../../Scrapers/Pipeline/Core/Builder/Validation/ApiDirectConfigRules.js';
import { validateApiDirectConfig } from '../../../../../Scrapers/Pipeline/Core/Builder/Validation/ApiDirectConfigRules.js';
import type { IApiDirectCallConfig } from '../../../../../Scrapers/Pipeline/Mediator/ApiDirectCall/ConfigContracts/index.js';

/** The bank's transport block, as the build-time validator reads it. */
type HeadlessBlock = Exclude<IApiDirectRuleInput['transport'], false>;

/** The values a group bank's login config names. */
interface IBrandLiterals {
  readonly host: string;
  readonly portalId: string;
  readonly aid: string;
  /** A JSON string: the bank number stands alone, never inside another value. */
  readonly bankNum: string;
  readonly provider: string;
}

/** A group bank: its registry id, website, config module and brand. */
interface IGroupBank {
  readonly companyId: CompanyTypes;
  readonly site: string;
  readonly module: string;
  readonly headlessExport: string;
  readonly brand: IBrandLiterals;
}

/** A group bank's login config and its transport block. */
interface ILoadedConfig {
  readonly call: IApiDirectCallConfig;
  readonly headless: HeadlessBlock;
}

const CONFIG_DIR = '../../../../../Scrapers/Pipeline/Registry/Config/';

const BEINLEUMI: IGroupBank = {
  companyId: CompanyTypes.Beinleumi,
  site: 'https://www.fibi.co.il',
  module: 'PipelineBankConfigBeinleumi.js',
  headlessExport: 'BEINLEUMI_TRANSPORT',
  brand: {
    host: 'online.fibi.co.il',
    portalId: 'FIBIPORTAL',
    aid: 'rest_app_031',
    bankNum: '"031"',
    provider: 'beinleumi-web',
  },
};

const SIBLINGS: readonly IGroupBank[] = [
  {
    companyId: CompanyTypes.Massad,
    site: 'https://www.bankmassad.co.il',
    module: 'PipelineBankConfigMassad.js',
    headlessExport: 'MASSAD_TRANSPORT',
    brand: {
      host: 'online.bankmassad.co.il',
      portalId: 'MASADPRTAL',
      aid: 'rest_app_046',
      bankNum: '"046"',
      provider: 'massad-web',
    },
  },
  {
    companyId: CompanyTypes.OtsarHahayal,
    site: 'https://www.bankotsar.co.il',
    module: 'PipelineBankConfigOtsarHahayal.js',
    headlessExport: 'OTSAR_HAHAYAL_TRANSPORT',
    brand: {
      host: 'online.bankotsar.co.il',
      portalId: 'OTSARPRTAL',
      aid: 'rest_app_014',
      bankNum: '"014"',
      provider: 'otsar-hahayal-web',
    },
  },
  {
    companyId: CompanyTypes.Pagi,
    site: 'https://www.pagi.co.il',
    module: 'PipelineBankConfigPagi.js',
    headlessExport: 'PAGI_TRANSPORT',
    brand: {
      host: 'online.pagi.co.il',
      portalId: 'PAGIPORTAL',
      aid: 'rest_app_052',
      bankNum: '"052"',
      provider: 'pagi-web',
    },
  },
];

/** The brand fields in swap order: the app id before the bank number it ends with. */
const SWAP_ORDER: readonly (keyof IBrandLiterals)[] = [
  'host',
  'portalId',
  'aid',
  'bankNum',
  'provider',
];

/**
 * Load a group bank's config module.
 * @param bank - The bank.
 * @returns Its login config and transport block.
 */
async function loadConfig(bank: IGroupBank): Promise<ILoadedConfig> {
  const loaded = (await import(`${CONFIG_DIR}${bank.module}`)) as Record<string, unknown>;
  const call = loaded.default as IApiDirectCallConfig;
  const headless = loaded[bank.headlessExport] as HeadlessBlock;
  return { call, headless };
}

/**
 * A config as JSON text; the config is pure data, so nothing is dropped.
 * @param config - The loaded config.
 * @returns Its text.
 */
function textOf(config: ILoadedConfig): string {
  return JSON.stringify(config);
}

/**
 * Swap one brand's literals for another's.
 * @param text - Config text naming the first brand.
 * @param to - The brand swapped in.
 * @returns The text naming the second brand.
 */
function swapBrand(text: string, to: IBrandLiterals): string {
  const from = BEINLEUMI.brand;
  return SWAP_ORDER.reduce((swapped, field) => swapped.replaceAll(from[field], to[field]), text);
}

describe.each(SIBLINGS)('$companyId api-direct login config (Beinleumi group)', sibling => {
  it('posts the login form with the ordinary-web Accept and reads its HTML answer', async () => {
    const { call } = await loadConfig(sibling);
    const logon = call.steps.find(step => step.name === 'logon');
    expect(logon).toMatchObject({
      headers: { accept: { $literal: 'text/html,application/xhtml+xml' } },
      response: 'text',
      mediaType: 'text/html',
    });
  });

  it("is Beinleumi's login with only the brand swapped", async () => {
    const beinleumi = await loadConfig(BEINLEUMI);
    const own = await loadConfig(sibling);
    const beinleumiText = textOf(beinleumi);
    const named = SWAP_ORDER.filter(field => beinleumiText.includes(BEINLEUMI.brand[field]));
    expect(named).toEqual(SWAP_ORDER);
    const expected = swapBrand(beinleumiText, sibling.brand);
    const ownText = textOf(own);
    expect(ownText).toBe(expected);
  });

  it('passes the build-time validator with its headless block', async () => {
    const { call, headless } = await loadConfig(sibling);
    const result = validateApiDirectConfig({ call, transport: headless });
    expect(result).toEqual({ success: true, value: true });
  });

  it('registers its website as an api-direct account bank on that block', async () => {
    const { headless } = await loadConfig(sibling);
    const registry = (await import(`${CONFIG_DIR}PipelineBankConfig.js`)) as Record<
      string,
      unknown
    >;
    const entries = registry.PIPELINE_BANK_CONFIG as Record<string, unknown>;
    const expected = { urls: { base: sibling.site }, transport: headless };
    expect(entries[sibling.companyId]).toEqual(expected);
  });
});
