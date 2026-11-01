/**
 * Step carry generators (N25). Once a step's `runIf` guard passes and before
 * its pre-hook and body hydration, each generator runs in order and its slots
 * merge into carry, so a later generator, the body and later steps can read
 * them. A generator that fails fails the step `<step> generate <kind> failed`
 * before any request; the message carries no generated material.
 */

import { ScraperErrorTypes } from '../../../../Base/ErrorTypes.js';
import type { Procedure } from '../../../Types/Procedure.js';
import { fail, isOk, succeed } from '../../../Types/Procedure.js';
import type { CarryGeneratorKind, ICarryGenerator, IStepConfig } from '../ConfigContracts/index.js';
import { generateEcdhKey } from '../Crypto/EcdhKeypair.js';
import { type GeneratedCarry, generateRsaKey } from '../Crypto/RsaKeyGenerator.js';
import type { ITemplateScope } from '../Template/RefResolver.js';
import generatePkcs10Csr from './RunStep.generate.csr.js';
import { mergeScopeCarry } from './RunStep.prepare.js';

/** The generator config of one kind. */
type GeneratorOf<TKind extends CarryGeneratorKind> = Extract<
  ICarryGenerator,
  { readonly kind: TKind }
>;

/** One runner per generator kind, each taking its own config. */
type GeneratorRuns = {
  readonly [TKind in CarryGeneratorKind]: (
    generator: GeneratorOf<TKind>,
    scope: ITemplateScope,
  ) => Promise<Procedure<GeneratedCarry>>;
};

/** One runner per generator kind — a new kind is one row. */
const GENERATOR_RUNS: GeneratorRuns = {
  'rsa-key': generateRsaKey,
  'pkcs10-csr': generatePkcs10Csr,
  'ecdh-key': generateEcdhKey,
};

/** The step whose generators run, and the scope so far. */
interface IGenerateCursor {
  readonly step: IStepConfig;
  readonly scope: ITemplateScope;
}

/**
 * The step failure for a generator that failed — no generated material.
 * @param cursor - Step and scope.
 * @param generator - The failed generator.
 * @returns Generic failure `<step> generate <kind> failed`.
 */
function generateFailed(cursor: IGenerateCursor, generator: ICarryGenerator): Procedure<never> {
  return fail(ScraperErrorTypes.Generic, `${cursor.step.name} generate ${generator.kind} failed`);
}

/**
 * Run a generator with the runner of its kind.
 * @param generator - Generator config.
 * @param scope - Scope so far.
 * @returns The runner's slots.
 */
function runOfKind<TKind extends CarryGeneratorKind>(
  generator: GeneratorOf<TKind>,
  scope: ITemplateScope,
): Promise<Procedure<GeneratedCarry>> {
  const kind: TKind = generator.kind;
  const run = GENERATOR_RUNS[kind];
  return run(generator, scope);
}

/**
 * Run one generator and merge its slots; a failure or rejection fails the step.
 * @param cursor - Step and scope so far.
 * @param generator - Generator config.
 * @returns Procedure with the scope plus the generated slots.
 */
async function runGenerator(
  cursor: IGenerateCursor,
  generator: ICarryGenerator,
): Promise<Procedure<ITemplateScope>> {
  const made = await runOfKind(generator, cursor.scope).catch((): false => false);
  if (made === false || !isOk(made)) return generateFailed(cursor, generator);
  const merged = mergeScopeCarry(cursor.scope, made.value);
  return succeed(merged);
}

/**
 * Run the step's generators from `index` on, each seeing the slots before it.
 * @param cursor - Step and scope so far.
 * @param index - Next generator.
 * @returns Procedure with the scope after every generator, or the first failure.
 */
async function generateFrom(
  cursor: IGenerateCursor,
  index: number,
): Promise<Procedure<ITemplateScope>> {
  const generators = cursor.step.generate ?? [];
  if (index >= generators.length) return succeed(cursor.scope);
  const next = await runGenerator(cursor, generators[index]);
  if (!isOk(next)) return next;
  return generateFrom({ step: cursor.step, scope: next.value }, index + 1);
}

/**
 * Run a step's carry generators in order.
 * @param step - Step config.
 * @param scope - Scope after the `runIf` guard passed.
 * @returns Procedure with the scope plus every generated slot, or the first failure.
 */
function generateStepCarry(
  step: IStepConfig,
  scope: ITemplateScope,
): Promise<Procedure<ITemplateScope>> {
  return generateFrom({ step, scope }, 0);
}

export default generateStepCarry;
export { generateStepCarry };
