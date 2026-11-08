/**
 * Detects repeated keys in serialized JSON without executing it.
 */

import { parseExpression } from '@babel/parser';

type ObjectProperty = Extract<
  ReturnType<typeof parseExpression>,
  { type: 'ObjectExpression' }
>['properties'][number];

/**
 * Whether an object property names the requested root field.
 * @param property - Parsed JSON object property.
 * @param field - Exact root field.
 * @returns True for a matching literal key.
 */
function isNamedProperty(property: ObjectProperty, field: string): boolean {
  return (
    property.type === 'ObjectProperty' &&
    property.key.type === 'StringLiteral' &&
    property.key.value === field
  );
}

/**
 * Whether an object contains repeated occurrences of the requested key.
 * @param json - Successfully parsed JSON object text.
 * @param field - Exact root field.
 * @returns True when the root key repeats.
 */
function hasDuplicateJsonField(json: string, field: string): boolean {
  const expression = parseExpression(json);
  if (expression.type !== 'ObjectExpression') return false;
  const matching = expression.properties.filter(property => isNamedProperty(property, field));
  return matching.length > 1;
}

/**
 * Reads a property name from JSON syntax.
 * @param property - Parsed property.
 * @returns Decoded key, or false for an unexpected shape.
 */
function propertyName(property: unknown): string | false {
  if (typeof property !== 'object' || property === null) return false;
  const key: unknown = Reflect.get(property, 'key');
  if (typeof key !== 'object' || key === null) return false;
  const value: unknown = Reflect.get(key, 'value');
  return typeof value === 'string' ? value : false;
}

/**
 * Whether an object repeats a decoded key.
 * @param properties - Parsed properties.
 * @returns True for repeated or unexpected keys.
 */
function hasRepeatedProperties(properties: readonly unknown[]): boolean {
  const names = properties.map(propertyName);
  return names.includes(false) || new Set(names).size !== names.length;
}

/**
 * Whether an array of syntax nodes contains a repeated object key.
 * @param nodes - Parsed child nodes.
 * @returns True for any repeated key.
 */
function anyDuplicate(nodes: readonly unknown[]): boolean {
  return nodes.some(hasDuplicateNode);
}

/**
 * Reads a list of parsed JSON children.
 * @param node - Parsed parent.
 * @param field - Child-list name.
 * @returns Its children.
 */
function childrenOf(node: object, field: string): readonly unknown[] {
  const children: unknown = Reflect.get(node, field);
  return Array.isArray(children) ? children : [];
}

/**
 * Whether an object or its children contain repeated keys.
 * @param node - Parsed JSON object.
 * @returns True for an ambiguous object.
 */
function hasDuplicateObject(node: object): boolean {
  const properties = childrenOf(node, 'properties');
  return hasRepeatedProperties(properties) || anyDuplicate(properties);
}

/**
 * Whether JSON syntax has a repeated key at any depth.
 * @param node - Parsed JSON node.
 * @returns True for repeated or unexpected object keys.
 */
function hasDuplicateNode(node: unknown): boolean {
  if (typeof node !== 'object' || node === null) return false;
  const type: unknown = Reflect.get(node, 'type');
  const value: unknown = Reflect.get(node, 'value');
  if (type === 'ObjectProperty') return hasDuplicateNode(value);
  const elements = childrenOf(node, 'elements');
  if (type === 'ArrayExpression') return anyDuplicate(elements);
  if (type !== 'ObjectExpression') return false;
  return hasDuplicateObject(node);
}

/**
 * Whether serialized JSON contains a repeated key at any depth.
 * @param json - Successfully parsed JSON text.
 * @returns True for an ambiguous object.
 */
function hasDuplicateJsonKeys(json: string): boolean {
  const expression = parseExpression(json);
  return hasDuplicateNode(expression);
}

export default hasDuplicateJsonField;
export { hasDuplicateJsonField, hasDuplicateJsonKeys };
