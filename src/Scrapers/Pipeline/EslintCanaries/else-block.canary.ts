// Canary: IfStatement[alternate] — use guard clauses, not else
function withElse(x: boolean): string {
  if (x) {
    return 'yes';
  } else {
    return 'no';
  }
}
export { withElse };
