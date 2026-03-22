// Canary: ReturnStatement > ObjectExpression — must use succeed()/fail()
function badReturn(): { success: boolean } {
  return { success: true };
}
export { badReturn };
