/**
 * Telebank group sibling — Mercantile's api-direct login is Discount's with
 * its brand swapped in: the routing cookie, the bank code, the two id
 * prefixes and the login page. Nothing else may differ, so the Discount
 * config suites prove Mercantile's flow, and a brand value the family
 * builders fail to thread through leaves a Discount literal behind and fails
 * here. Each swap is an exact quoted JSON token whose count in Discount's
 * text is asserted first, so no swap is vacuous or over-broad. Each value is
 * copied from the protocol, never read from the config under test.
 *
 * Uses dynamic imports for `Registry/Config/*` per the project's test rule
 * (Pipeline tests don't statically import from Registry/Config).
 */

import { CompanyTypes } from '../../../../../Definitions.js';
import type { IApiDirectRuleInput } from '../../../../../Scrapers/Pipeline/Core/Builder/Validation/ApiDirectConfigRules.js';
import { validateApiDirectConfig } from '../../../../../Scrapers/Pipeline/Core/Builder/Validation/ApiDirectConfigRules.js';
import type { IApiDirectCallConfig } from '../../../../../Scrapers/Pipeline/Mediator/ApiDirectCall/ConfigContracts/index.js';

/** The bank's headless block, as the build-time validator reads it. */
type HeadlessBlock = Exclude<IApiDirectRuleInput['transport'], false>;

/** A group bank's login config and its headless block. */
interface ILoadedConfig {
  readonly call: IApiDirectCallConfig;
  readonly headless: HeadlessBlock;
}

/** One brand token: Discount's, Mercantile's, and how often Discount's appears. */
interface ISwap {
  readonly from: string;
  readonly to: string;
  readonly count: number;
}

const CONFIG_DIR = '../../../../../Scrapers/Pipeline/Registry/Config/';

const LOGIN_URL = 'https://start.telebank.co.il/login/';

/** The brand tokens, each quoted so it never matches inside another value. */
const SWAPS: readonly ISwap[] = [
  { from: '"discount"', to: '"merkantil"', count: 1 },
  { from: '{"$literal":"d"}', to: '{"$literal":"m"}', count: 2 },
  { from: '"00001"', to: '"00011"', count: 1 },
  { from: '"0000"', to: '"0001"', count: 1 },
  { from: `"${LOGIN_URL}"`, to: `"${LOGIN_URL}?bank=m"`, count: 5 },
];

/**
 * Load a group bank's config module as JSON text; the config is pure data,
 * so nothing is dropped.
 * @param module - The config module's file name.
 * @param headlessExport - The name its headless block is exported under.
 * @returns The login config and headless block, and their text.
 */
async function loadConfig(
  module: string,
  headlessExport: string,
): Promise<ILoadedConfig & { readonly text: string }> {
  const loaded = (await import(`${CONFIG_DIR}${module}`)) as Record<string, unknown>;
  const call = loaded.default as IApiDirectCallConfig;
  const headless = loaded[headlessExport] as HeadlessBlock;
  const text = JSON.stringify({ call, headless });
  return { call, headless, text };
}

/**
 * Count a token's occurrences.
 * @param text - Text to search.
 * @param token - Exact token.
 * @returns How many times it appears.
 */
function countOf(text: string, token: string): number {
  return text.split(token).length - 1;
}

/**
 * Swap Discount's brand tokens for Mercantile's.
 * @param text - Config text naming Discount.
 * @returns The text naming Mercantile.
 */
function swapBrand(text: string): string {
  return SWAPS.reduce((swapped, swap) => swapped.replaceAll(swap.from, swap.to), text);
}

describe('Mercantile api-direct login config (Telebank group)', () => {
  it('names each Discount brand token as often as the swap table says', async () => {
    const discount = await loadConfig('PipelineBankConfigDiscount.js', 'DISCOUNT_TRANSPORT');
    const counts = SWAPS.map(swap => countOf(discount.text, swap.from));
    const expected = SWAPS.map(swap => swap.count);
    expect(counts).toEqual(expected);
  });

  it("is Discount's login with only the brand swapped", async () => {
    const discount = await loadConfig('PipelineBankConfigDiscount.js', 'DISCOUNT_TRANSPORT');
    const own = await loadConfig('PipelineBankConfigMercantile.js', 'MERCANTILE_TRANSPORT');
    const expected = swapBrand(discount.text);
    expect(own.text).toBe(expected);
  });

  it('passes the build-time validator with its headless block', async () => {
    const { call, headless } = await loadConfig(
      'PipelineBankConfigMercantile.js',
      'MERCANTILE_TRANSPORT',
    );
    const result = validateApiDirectConfig({ call, transport: headless });
    expect(result).toEqual({ success: true, value: true });
  });

  it('registers its website as an api-direct account bank on that block', async () => {
    const { headless } = await loadConfig(
      'PipelineBankConfigMercantile.js',
      'MERCANTILE_TRANSPORT',
    );
    const registry = (await import(`${CONFIG_DIR}PipelineBankConfig.js`)) as Record<
      string,
      unknown
    >;
    const entries = registry.PIPELINE_BANK_CONFIG as Record<string, unknown>;
    const expected = { urls: { base: 'https://www.mercantile.co.il' }, transport: headless };
    expect(entries[CompanyTypes.Mercantile]).toEqual(expected);
  });
});
