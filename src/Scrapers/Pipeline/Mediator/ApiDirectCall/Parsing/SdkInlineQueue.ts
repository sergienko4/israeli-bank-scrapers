/**
 * Recognizes static inline entries in the Next.js script queue.
 */

import type { parse } from '@babel/parser';

type Statement = ReturnType<typeof parse>['program']['body'][number];
type Expression = Extract<Statement, { type: 'ExpressionStatement' }>['expression'];
type Call = Extract<Expression, { type: 'CallExpression' }>;
type Argument = Call['arguments'][number];
type ArrayNode = Extract<Argument, { type: 'ArrayExpression' }>;
type Element = NonNullable<ArrayNode['elements'][number]>;
type ObjectNode = Extract<Element, { type: 'ObjectExpression' }>;
type Property = ObjectNode['properties'][number];

/**
 * Rejects computed attributes and properties that could name a source.
 * @param property - Unevaluated inline-script property.
 * @returns Whether it is a static non-source attribute.
 */
function safeProperty(property: Property): boolean {
  if (property.type !== 'ObjectProperty' || property.computed) return false;
  const { key, value } = property;
  if (key.type !== 'Identifier' && key.type !== 'StringLiteral') return false;
  const name = key.type === 'Identifier' ? key.name : key.value;
  if (name === '' || name.toLowerCase() === 'src') return false;
  return ['StringLiteral', 'NumericLiteral', 'BooleanLiteral', 'NullLiteral'].includes(value.type);
}

/**
 * Excludes a static inline script, which is not an external SDK source.
 * @param node - Queue push expression.
 * @returns Whether its literal zero marker and attributes prove it is inline.
 */
function isInlineQueue(node: Call): boolean {
  if (node.arguments.length !== 1) return false;
  const argument = node.arguments[0];
  if (argument.type !== 'ArrayExpression' || argument.elements.length !== 2) return false;
  const [marker, props] = argument.elements;
  if (marker?.type !== 'NumericLiteral' || marker.value !== 0) return false;
  return props?.type === 'ObjectExpression' && props.properties.every(safeProperty);
}

export default isInlineQueue;
