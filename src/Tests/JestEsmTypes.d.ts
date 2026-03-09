// Augment @jest/globals to use @types/jest compatible types.
// In ESM mode, jest must be imported from @jest/globals for runtime,
// but @types/jest provides the permissive global types we rely on.

/** Shape of Jest ESM mock module function. */
type MockModuleFn = <T = unknown>(
  moduleName: string,
  factory: () => T | Promise<T>,
  options?: { virtual?: boolean },
) => typeof jest;

/** Jest namespace augmentation with ESM-only APIs. */
interface IJestEsmAugmentation {
  /* eslint @typescript-eslint/naming-convention: ["error", { selector: "property", format: null }] */
  unstable_mockModule: MockModuleFn;
}

declare module '@jest/globals' {
  const jest: typeof globalThis.jest & IJestEsmAugmentation;
  export default jest;
  export { jest };
}
