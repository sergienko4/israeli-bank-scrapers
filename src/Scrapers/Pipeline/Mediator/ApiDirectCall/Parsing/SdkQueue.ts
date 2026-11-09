/**
 * Reads the observed top-level Next.js script queue without evaluating code.
 */

import { parse } from '@babel/parser';

import isInlineQueue from './SdkInlineQueue.js';

type Statement = ReturnType<typeof parse>['program']['body'][number];
type Expression = Extract<Statement, { type: 'ExpressionStatement' }>['expression'];
type Member = Extract<Expression, { type: 'MemberExpression' }>;
type Assignment = Extract<Expression, { type: 'AssignmentExpression' }>;
type QueueNode = Expression | Member['object'] | Member['property'] | Assignment['left'];

/**
 * Whether a node names the observed script queue.
 * @param node - Parsed JavaScript node.
 * @returns True only for self.__next_s.
 */
function isQueue(node: QueueNode): boolean {
  if (node.type !== 'MemberExpression' || node.computed) return false;
  if (node.object.type !== 'Identifier' || node.object.name !== 'self') return false;
  return node.property.type === 'Identifier' && node.property.name === '__next_s';
}

/**
 * Whether a queue assignment initializes it to an empty array.
 * @param node - Parsed JavaScript node.
 * @returns True for the observed fallback initialization.
 */
function initializesQueue(node: QueueNode): boolean {
  if (node.type !== 'AssignmentExpression' || node.operator !== '=' || !isQueue(node.left))
    return false;
  const right = node.right;
  if (right.type !== 'LogicalExpression' || right.operator !== '||' || !isQueue(right.left))
    return false;
  return right.right.type === 'ArrayExpression' && right.right.elements.length === 0;
}

/**
 * Reads the source literal from a single-entry queue call.
 * @param node - Parsed call expression.
 * @returns The source literal.
 * @throws If there is not one argument or its source is not a string literal.
 */
function firstSource(node: Extract<Expression, { type: 'CallExpression' }>): string {
  if (node.arguments.length !== 1) throw new SyntaxError('invalid script queue arguments');
  const first = node.arguments.at(0);
  const source = first?.type === 'ArrayExpression' ? first.elements[0] : undefined;
  if (source?.type !== 'StringLiteral') throw new SyntaxError('invalid script queue source');
  return source.value;
}

/**
 * Reads a literal source from the observed queue push shape.
 * @param node - Top-level expression.
 * @returns Literal source, or undefined for other syntax.
 */
function sourceOf(node: Expression): string | false {
  if (node.type !== 'CallExpression' || node.callee.type !== 'MemberExpression') return false;
  const { callee } = node;
  if (callee.computed || callee.property.type !== 'Identifier' || callee.property.name !== 'push')
    return false;
  if (!isQueue(callee.object) && !initializesQueue(callee.object)) return false;
  if (isInlineQueue(node)) return false;
  return firstSource(node);
}

/**
 * Reads literal queue sources from relevant script syntax.
 * @param text - Unevaluated JavaScript source.
 * @returns Queue sources; malformed relevant syntax throws.
 */
function queueSources(text: string): readonly string[] {
  if (!text.includes('__next_s')) return [];
  const statements = parse(text, { sourceType: 'unambiguous' }).program.body;
  return statements.flatMap(statement => {
    if (statement.type !== 'ExpressionStatement') return [];
    const source = sourceOf(statement.expression);
    return source === false ? [] : [source];
  });
}

export default queueSources;
export { queueSources };
