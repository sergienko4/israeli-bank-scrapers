// Augment @jest/globals to use @types/jest compatible types.
// In ESM mode, jest must be imported from @jest/globals for runtime,
// but @types/jest provides the permissive global types we rely on.
declare namespace jest {
  function unstable_mockModule<T = unknown>(
    moduleName: string,
    factory: () => T | Promise<T>,
    options?: { virtual?: boolean },
  ): typeof jest;
}

declare module '@jest/globals' {
  export const jest: typeof globalThis.jest;
}
