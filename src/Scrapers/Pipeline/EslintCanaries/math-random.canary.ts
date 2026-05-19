// Canary: Math.random() is forbidden — use node:crypto's randomBytes /
// randomInt / randomUUID. SonarCloud rule S2245 (weak PRNG). If this
// file ever stops triggering an ESLint error, the architectural rule
// was weakened or removed — `verify.sh` will fail the build.
const weak = Math.random();

export { weak };
