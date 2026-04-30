// Canary: void return type ban — functions must return meaningful values
function doNothing(): void {
  console.log('side effect');
}

export { doNothing };
