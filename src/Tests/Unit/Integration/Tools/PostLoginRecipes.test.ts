/**
 * Unit tests for PostLoginRecipes — per-bank PHASE_CHAIN capture script.
 */

import ScraperError from '../../../../Scrapers/Base/ScraperError.js';
import { isSome } from '../../../../Scrapers/Pipeline/Types/Option.js';
import { knownBanks } from '../../../Integration/Tools/CredentialLoader.js';
import {
  getPostLoginRecipe,
  knownPostLoginBanks,
  POST_LOGIN_RECIPES,
} from '../../../Integration/Tools/PostLoginRecipes.js';
import type { IExtendedRecipe } from '../../../Integration/Tools/RecipeStepTypes.js';

/**
 * Helper that unwraps an Option<recipe> and asserts presence via Jest.
 *
 * @param bankId - Bank to look up.
 * @returns The recipe value when present (test fails when absent).
 */
function requireRecipe(bankId: string): IExtendedRecipe {
  const opt = getPostLoginRecipe(bankId);
  const isPresent = isSome(opt);
  expect(isPresent).toBe(true);
  if (!isPresent) throw new ScraperError(`recipe missing for ${bankId}`);
  return opt.value;
}

describe('PostLoginRecipes', () => {
  it('knownPostLoginBanks lists every onboarded pipeline bank', () => {
    const banks = knownPostLoginBanks();
    const expected = [
      'amex',
      'beinleumi',
      'discount',
      'hapoalim',
      'isracard',
      'leumi',
      'max',
      'visaCal',
    ];
    expect(banks).toEqual(expected);
  });

  it('every credential-loader bank has a post-login recipe (closed coverage gate)', () => {
    const postLoginBanks = knownPostLoginBanks();
    const credentialBanks = knownBanks();
    expect(postLoginBanks).toEqual(credentialBanks);
  });

  it('getPostLoginRecipe returns None for unknown banks', () => {
    const opt = getPostLoginRecipe('nonexistent');
    const isPresent = isSome(opt);
    expect(isPresent).toBe(false);
  });

  it('every recipe starts with a login step', () => {
    const entries = Object.values(POST_LOGIN_RECIPES);
    entries.forEach(recipe => {
      if (recipe !== undefined) {
        const first = recipe.steps[0];
        expect(first).toBeDefined();
        expect(first.kind).toBe('login');
      }
    });
  });

  it('Hapoalim recipe captures the cycle-billing endpoint (locks in PR-B2 bug fixture)', () => {
    const recipe = requireRecipe('hapoalim');
    const patterns = recipe.steps.flatMap(step =>
      step.kind === 'recordResponse' ? [step.urlPattern] : [],
    );
    const sortedPatterns = [...patterns].sort();
    expect(sortedPatterns).toContain('/cycle-billing');
    expect(sortedPatterns).toContain('/movements/preview');
  });

  it('SPA banks (beinleumi, visaCal) use snapshot with networkidle for hydrated DOM', () => {
    const spaBankIds: readonly string[] = ['beinleumi', 'visaCal'];
    spaBankIds.forEach(bankId => {
      const recipe = requireRecipe(bankId);
      const hasNetworkidleSnapshot = recipe.steps.some(
        step => step.kind === 'snapshot' && step.waitForLifecycle === 'networkidle',
      );
      expect(hasNetworkidleSnapshot).toBe(true);
    });
  });

  it('every recipe step has a unique stepName within the recipe', () => {
    const entries = Object.entries(POST_LOGIN_RECIPES);
    entries.forEach(([bankId, recipe]) => {
      if (recipe !== undefined) {
        const names = recipe.steps.map(step => step.stepName);
        const unique = new Set(names);
        expect(unique.size).toBe(names.length);
        expect(bankId).toBe(recipe.bankId);
      }
    });
  });
});
