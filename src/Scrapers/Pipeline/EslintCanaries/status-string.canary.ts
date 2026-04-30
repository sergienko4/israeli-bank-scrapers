// Canary: hardcoded status string — use Enums or Constants
function checkStatus(x: string): boolean {
  if (x === 'success') return true;
  return false;
}

export { checkStatus };
