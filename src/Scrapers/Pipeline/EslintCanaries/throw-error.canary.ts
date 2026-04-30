// Canary: ThrowStatement — Pipeline code must use Result Pattern, not throw
function crasher(): boolean {
  throw new Error('should use fail()');
}

export { crasher };
