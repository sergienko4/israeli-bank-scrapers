/**
 * Heuristic strategy types — discriminated union mapped per credential key.
 */

/** Strategy for resolving a password-type field. */
interface IPasswordStrategy {
  /** Discriminator. */
  readonly type: 'password';
}

/** Strategy for resolving a text-type field by positional index. */
interface ITextStrategy {
  /** Discriminator. */
  readonly type: 'text';
  /** 0-based index inside the visible-text-input list. */
  readonly index: number;
}

/** Union of heuristic resolution strategies. */
type HeuristicStrategy = IPasswordStrategy | ITextStrategy;

/** Map credential keys to their heuristic resolution strategy. */
const HEURISTIC_MAP: Readonly<Partial<Record<string, HeuristicStrategy>>> = {
  password: { type: 'password' },
  id: { type: 'text', index: 0 },
  username: { type: 'text', index: 0 },
  nationalID: { type: 'text', index: 0 },
  userCode: { type: 'text', index: 0 },
  num: { type: 'text', index: 1 },
  card6Digits: { type: 'text', index: 2 },
};

/** CSS selector for password inputs. */
const PASSWORD_SELECTOR = 'input[type="password"]';

/** CSS selector for visible text-like inputs (excludes password and hidden). */
const TEXT_INPUT_SELECTOR =
  'input:not([type="password"]):not([type="hidden"]):not([type="submit"]):not([type="button"])';

export { HEURISTIC_MAP, PASSWORD_SELECTOR, TEXT_INPUT_SELECTOR };
export type { HeuristicStrategy, IPasswordStrategy, ITextStrategy };
