/**
 * A GitHub Actions `if:` evaluator for workflow-wiring tests.
 *
 * <p>It covers the subset the workflows' conditions use: `!`, `&&`, `||`,
 * `==`, `!=`, parentheses, string and boolean literals, `needs.<job>.result`,
 * `needs.<job>.outputs.<name>` and the four status functions. As on GitHub, a
 * condition that names no status function runs as `success() && (<it>)`,
 * `&&` / `||` short-circuit and yield the operand that decides them, and
 * strings compare case-insensitively. Anything outside the subset throws, so
 * an unmodelled condition fails its test rather than evaluating to a guess.
 */

/** A value an expression yields. */
export type GhaValue = string | boolean;

/** One needed job, as `needs.<job>` exposes it. */
export interface INeed {
  readonly result: string;
  readonly outputs: Readonly<Record<string, string>>;
}

/** What the status functions report where the condition is checked. */
export interface IGhaStatus {
  readonly success: boolean;
  readonly failure: boolean;
  readonly cancelled: boolean;
}

/** Everything a condition can read. */
export interface IGhaContext {
  readonly needs: Readonly<Record<string, INeed>>;
  readonly status: IGhaStatus;
}

type TokenKind = 'op' | 'str' | 'word' | 'end';

interface IToken {
  readonly kind: TokenKind;
  readonly text: string;
}

interface ICursor {
  readonly tokens: readonly IToken[];
  pos: number;
}

type BinaryKind = 'and' | 'or' | 'eq' | 'ne';

interface IBinary<TKind extends BinaryKind = BinaryKind> {
  readonly kind: TKind;
  readonly left: Node;
  readonly right: Node;
}

interface INot {
  readonly kind: 'not';
  readonly operand: Node;
}

interface ICall {
  readonly kind: 'call';
  readonly name: string;
}

interface ILiteral {
  readonly kind: 'literal';
  readonly value: GhaValue;
}

interface IPath {
  readonly kind: 'path';
  readonly path: readonly string[];
}

type Node =
  IBinary<'and'> | IBinary<'or'> | IBinary<'eq'> | IBinary<'ne'> | INot | ICall | ILiteral | IPath;
type NodeKind = Node['kind'];
type Evaluate = (node: Node, context: IGhaContext) => GhaValue;
type Evaluators = {
  readonly [K in NodeKind]: (node: Extract<Node, { kind: K }>, context: IGhaContext) => GhaValue;
};

/** Each token kind and its pattern, tried in order after any blanks. */
const TOKEN_PATTERNS: readonly (readonly [TokenKind, RegExp])[] = [
  ['op', /^\s*(&&|\|\||==|!=|[!()])/u],
  ['str', /^\s*'((?:[^']|'')*)'/u],
  ['word', /^\s*([A-Za-z_][\w.-]*)/u],
];
const END: IToken = { kind: 'end', text: '' };
const WRAPPED = /^\s*\$\{\{([\s\S]*)\}\}\s*$/u;
const COMPARISONS: Readonly<Record<string, 'eq' | 'ne'>> = { '==': 'eq', '!=': 'ne' };
const BOOLEANS: Readonly<Record<string, boolean>> = { true: true, false: false };

/** The status functions, read off the context. */
const STATUS_FUNCTIONS: Readonly<Record<string, (status: IGhaStatus) => boolean>> = {
  /**
   * `success()`.
   * @param status - The status where the condition is checked.
   * @returns Whether everything before succeeded.
   */
  success: status => status.success,
  /**
   * `failure()`.
   * @param status - The status where the condition is checked.
   * @returns Whether anything before failed.
   */
  failure: status => status.failure,
  /**
   * `cancelled()`.
   * @param status - The status where the condition is checked.
   * @returns Whether the run was cancelled.
   */
  cancelled: status => status.cancelled,
  /**
   * `always()`.
   * @returns True.
   */
  always: () => true,
};

/** How a `needs.<job>.<field>…` lookup reads the rest of its path. */
const NEED_FIELDS: Readonly<Record<string, (need: INeed, rest: readonly string[]) => GhaValue>> = {
  /**
   * `needs.<job>.result`.
   * @param need - The needed job.
   * @param rest - The path after `result`; must be empty.
   * @returns The job's result.
   */
  result: (need, rest) => (rest.length === 0 ? need.result : unmodelled(rest)),
  /**
   * `needs.<job>.outputs.<name>`.
   * @param need - The needed job.
   * @param rest - The path after `outputs`; must be one modelled name.
   * @returns The output's value.
   */
  outputs: (need, rest) => {
    const [name = ''] = rest;
    const isModelled = rest.length === 1 && Object.hasOwn(need.outputs, name);
    return isModelled ? need.outputs[name] : unmodelled(rest);
  },
};

/**
 * Fail on a lookup the evaluator does not model.
 *
 * @param path - The path that was read.
 * @returns Never; always throws.
 */
function unmodelled(path: readonly string[]): never {
  throw new RangeError(`unmodelled lookup: ${path.join('.')}`);
}

/**
 * Strip an optional `${{ … }}` wrapper.
 *
 * @param source - The `if:` text.
 * @returns The bare expression.
 */
function unwrap(source: string): string {
  const match = WRAPPED.exec(source);
  return match?.[1] ?? source;
}

/**
 * Read one token.
 *
 * @param source - The expression.
 * @param at - Where to start reading.
 * @returns The token and the index after it; throws on unmodelled syntax.
 */
function readToken(source: string, at: number): readonly [IToken, number] {
  const rest = source.slice(at);
  const hit = TOKEN_PATTERNS.find(([, pattern]) => pattern.test(rest));
  if (hit === undefined) throw new SyntaxError(`unmodelled syntax at ${String(at)}: ${rest}`);
  const [kind, pattern] = hit;
  const [whole, raw] = pattern.exec(rest) ?? ['', ''];
  const text = kind === 'str' ? raw.replaceAll("''", "'") : raw;
  return [{ kind, text }, at + whole.length];
}

/**
 * Split an expression into tokens.
 *
 * @param source - The expression.
 * @returns Its tokens, closed by an end token.
 */
function tokenize(source: string): readonly IToken[] {
  const tokens: IToken[] = [];
  const end = source.trimEnd().length;
  let at = 0;
  while (at < end) {
    const [token, next] = readToken(source, at);
    tokens.push(token);
    at = next;
  }
  return [...tokens, END];
}

/**
 * The token under the cursor.
 *
 * @param cursor - The parse cursor.
 * @returns The token, or the end token.
 */
function peek(cursor: ICursor): IToken {
  return cursor.tokens[cursor.pos] ?? END;
}

/**
 * Consume an operator token when it is next.
 *
 * @param cursor - The parse cursor.
 * @param text - The operator.
 * @returns True when it was next and is now consumed.
 */
function accept(cursor: ICursor, text: string): boolean {
  const token = peek(cursor);
  if (token.kind !== 'op' || token.text !== text) return false;
  cursor.pos += 1;
  return true;
}

/**
 * Consume an operator token that must be next.
 *
 * @param cursor - The parse cursor.
 * @param text - The operator.
 * @returns True; throws when it is not next.
 */
function expectOp(cursor: ICursor, text: string): boolean {
  if (accept(cursor, text)) return true;
  throw new SyntaxError(`expected ${text} at token ${String(cursor.pos)}`);
}

/**
 * Parse `a || b || …`.
 *
 * @param cursor - The parse cursor.
 * @returns The expression tree.
 */
function parseOr(cursor: ICursor): Node {
  let node = parseAnd(cursor);
  while (accept(cursor, '||')) node = { kind: 'or', left: node, right: parseAnd(cursor) };
  return node;
}

/**
 * Parse `a && b && …`.
 *
 * @param cursor - The parse cursor.
 * @returns The expression tree.
 */
function parseAnd(cursor: ICursor): Node {
  let node = parseComparison(cursor);
  while (accept(cursor, '&&')) node = { kind: 'and', left: node, right: parseComparison(cursor) };
  return node;
}

/**
 * Parse `a == b`, `a != b` or a lone operand.
 *
 * @param cursor - The parse cursor.
 * @returns The expression tree.
 */
function parseComparison(cursor: ICursor): Node {
  const left = parseUnary(cursor);
  const token = peek(cursor);
  const kind = token.kind === 'op' ? COMPARISONS[token.text] : undefined;
  if (kind === undefined) return left;
  cursor.pos += 1;
  return { kind, left, right: parseUnary(cursor) };
}

/**
 * Parse `!a` or an operand.
 *
 * @param cursor - The parse cursor.
 * @returns The expression tree.
 */
function parseUnary(cursor: ICursor): Node {
  if (accept(cursor, '!')) return { kind: 'not', operand: parseUnary(cursor) };
  return parsePrimary(cursor);
}

/**
 * Parse a parenthesised expression, a literal, a call or a lookup.
 *
 * @param cursor - The parse cursor.
 * @returns The expression tree.
 */
function parsePrimary(cursor: ICursor): Node {
  if (accept(cursor, '(')) {
    const inner = parseOr(cursor);
    expectOp(cursor, ')');
    return inner;
  }
  const token = peek(cursor);
  cursor.pos += 1;
  if (token.kind === 'str') return { kind: 'literal', value: token.text };
  if (token.kind === 'word') return parseWord(token.text, cursor);
  throw new SyntaxError(`unexpected ${token.kind} '${token.text}' at token ${String(cursor.pos)}`);
}

/**
 * Parse a bare word: a boolean, a status-function call or a lookup path.
 *
 * @param word - The word.
 * @param cursor - The parse cursor, after the word.
 * @returns The expression tree.
 */
function parseWord(word: string, cursor: ICursor): Node {
  if (Object.hasOwn(BOOLEANS, word)) return { kind: 'literal', value: BOOLEANS[word] ?? false };
  if (!accept(cursor, '(')) return { kind: 'path', path: word.split('.') };
  expectOp(cursor, ')');
  if (Object.hasOwn(STATUS_FUNCTIONS, word)) return { kind: 'call', name: word };
  throw new SyntaxError(`unmodelled function ${word}()`);
}

/**
 * Parse a whole condition.
 *
 * @param source - The `if:` text, bare or `${{ … }}`-wrapped.
 * @returns The expression tree; throws on trailing or unmodelled syntax.
 */
function parseCondition(source: string): Node {
  const bare = unwrap(source);
  const tokens = tokenize(bare);
  const cursor: ICursor = { tokens, pos: 0 };
  const node = parseOr(cursor);
  if (peek(cursor).kind === 'end') return node;
  throw new SyntaxError(`unexpected '${peek(cursor).text}' at token ${String(cursor.pos)}`);
}

/**
 * GitHub's truthiness: `false` and the empty string are falsy.
 *
 * @param value - The value.
 * @returns Its truthiness.
 */
function truthy(value: GhaValue): boolean {
  return value !== false && value !== '';
}

/**
 * GitHub's `==` on the modelled types.
 *
 * @param left - The left value.
 * @param right - The right value.
 * @returns True when equal; strings ignore case. Throws on mixed types.
 */
function equals(left: GhaValue, right: GhaValue): boolean {
  if (typeof left !== typeof right) throw new RangeError('unmodelled mixed-type comparison');
  if (typeof left === 'boolean') return left === right;
  return left.toLowerCase() === String(right).toLowerCase();
}

/**
 * Read a `needs.<job>…` lookup.
 *
 * @param path - The lookup path.
 * @param context - The condition's context.
 * @returns The value; throws on any lookup the evaluator does not model.
 */
function lookup(path: readonly string[], context: IGhaContext): GhaValue {
  const [root, job = '', field = '', ...rest] = path;
  const isNeed = Object.hasOwn(context.needs, job) && Object.hasOwn(NEED_FIELDS, field);
  const isModelled = root === 'needs' && isNeed;
  if (!isModelled) return unmodelled(path);
  return NEED_FIELDS[field](context.needs[job], rest);
}

/**
 * Whether the left operand of `&&` / `||` decides it: `&&` stops at a falsy
 * one, `||` at a truthy one.
 */
const DECIDED_BY_LEFT: Readonly<Record<'and' | 'or', (left: GhaValue) => boolean>> = {
  /**
   * `a && b`.
   * @param left - The value of `a`.
   * @returns Whether `a` is falsy.
   */
  and: left => !truthy(left),
  /**
   * `a || b`.
   * @param left - The value of `a`.
   * @returns Whether `a` is truthy.
   */
  or: left => truthy(left),
};

/**
 * `a && b` or `a || b` as GitHub evaluates it: the left operand when it
 * decides the result, else the right one, which is read only then.
 *
 * @param node - The node.
 * @param context - The condition's context.
 * @returns The operand that decides it.
 */
function logical(node: IBinary<'and' | 'or'>, context: IGhaContext): GhaValue {
  const left = evaluate(node.left, context);
  return DECIDED_BY_LEFT[node.kind](left) ? left : evaluate(node.right, context);
}

/** How each kind of node evaluates; `&&` and `||` short-circuit. */
const EVALUATORS: Evaluators = {
  /**
   * `a && b`.
   * @param node - The node.
   * @param context - The condition's context.
   * @returns `a` when it is falsy, else `b`.
   */
  and: (node, context) => logical(node, context),
  /**
   * `a || b`.
   * @param node - The node.
   * @param context - The condition's context.
   * @returns `a` when it is truthy, else `b`.
   */
  or: (node, context) => logical(node, context),
  /**
   * `a == b`.
   * @param node - The node.
   * @param context - The condition's context.
   * @returns Whether the sides are equal.
   */
  eq: (node, context) => compare(node, context),
  /**
   * `a != b`.
   * @param node - The node.
   * @param context - The condition's context.
   * @returns Whether the sides differ.
   */
  ne: (node, context) => !compare(node, context),
  /**
   * `!a`.
   * @param node - The node.
   * @param context - The condition's context.
   * @returns Whether the operand is falsy.
   */
  not: (node, context) => !holds(node.operand, context),
  /**
   * A status function; the parser admits no other call.
   * @param node - The node.
   * @param context - The condition's context.
   * @returns What the function reports.
   */
  call: (node, context) => STATUS_FUNCTIONS[node.name](context.status),
  /**
   * A literal.
   * @param node - The node.
   * @returns Its value.
   */
  literal: node => node.value,
  /**
   * A `needs` lookup.
   * @param node - The node.
   * @param context - The condition's context.
   * @returns The looked-up value.
   */
  path: (node, context) => lookup(node.path, context),
};

/**
 * Evaluate one expression tree.
 *
 * @param node - The tree.
 * @param context - The condition's context.
 * @returns Its value.
 */
function evaluate(node: Node, context: IGhaContext): GhaValue {
  const evaluator = EVALUATORS[node.kind] as Evaluate;
  return evaluator(node, context);
}

/**
 * Evaluate one tree to its truthiness.
 *
 * @param node - The tree.
 * @param context - The condition's context.
 * @returns Whether its value is truthy.
 */
function holds(node: Node, context: IGhaContext): boolean {
  const value = evaluate(node, context);
  return truthy(value);
}

/**
 * Evaluate both sides of a comparison and compare them.
 *
 * @param node - The comparison.
 * @param context - The condition's context.
 * @returns Whether the sides are equal.
 */
function compare(node: IBinary, context: IGhaContext): boolean {
  const left = evaluate(node.left, context);
  const right = evaluate(node.right, context);
  return equals(left, right);
}

/**
 * The subtrees of one node.
 *
 * @param node - The node.
 * @returns Its direct children.
 */
function childrenOf(node: Node): readonly Node[] {
  if (node.kind === 'not') return [node.operand];
  if ('left' in node) return [node.left, node.right];
  return [];
}

/**
 * Whether a tree calls a status function anywhere.
 *
 * @param node - The tree.
 * @returns True when it names `success()`, `failure()`, `cancelled()` or `always()`.
 */
function namesStatus(node: Node): boolean {
  if (node.kind === 'call') return true;
  const children = childrenOf(node);
  return children.some(namesStatus);
}

/**
 * Whether a condition names a status function, and so opts out of the
 * implicit `success()`.
 *
 * @param source - The `if:` text.
 * @returns True when it names one.
 */
export function namesStatusFunction(source: string): boolean {
  const node = parseCondition(source);
  return namesStatus(node);
}

/**
 * Evaluate an `if:` as GitHub does.
 *
 * @param source - The `if:` text, bare or `${{ … }}`-wrapped.
 * @param context - The needs and status where it is checked.
 * @returns Whether the job or step runs.
 */
export function evaluateIf(source: string, context: IGhaContext): boolean {
  const node = parseCondition(source);
  const implicit: Node = { kind: 'call', name: 'success' };
  const effective: Node = namesStatus(node) ? node : { kind: 'and', left: implicit, right: node };
  const value = evaluate(effective, context);
  return truthy(value);
}

/**
 * The job-level status functions, from the needed jobs' results.
 *
 * @param needs - The needed jobs.
 * @param cancelled - Whether the run was cancelled.
 * @returns `success()` when every need succeeded and the run goes on,
 *   `failure()` when any need failed, and `cancelled()`.
 */
export function jobStatus(needs: Readonly<Record<string, INeed>>, cancelled: boolean): IGhaStatus {
  const results = Object.values(needs).map(need => need.result);
  const isAllSucceeded = results.every(result => result === 'success');
  const hasFailed = results.includes('failure');
  return { success: isAllSucceeded && !cancelled, failure: hasFailed, cancelled };
}
