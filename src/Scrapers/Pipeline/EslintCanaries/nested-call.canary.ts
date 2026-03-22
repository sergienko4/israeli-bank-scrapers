// Canary: nested CallExpression — assign to descriptive variable first
function outer(x: number): number {
  return x;
}
function inner(): number {
  return 1;
}
const result = outer(inner());
export { result };
