// Canary: ReturnStatement[argument=null] — bare return; must be caught
function earlyExit(): boolean {
  // @ts-expect-error Intentional: canary tests bare return
  return;
}
export { earlyExit };
