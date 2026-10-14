/**
 * TsProgram — a TypeScript program over files held in memory, for oracles
 * that must know what a name refers to, not only how it is spelled.
 *
 * <p>The files given are read from memory; anything else the program needs
 * (an import, a type from `node_modules`) comes from disk. Its checker
 * resolves a name to its declaration, so a shadowing parameter, a block
 * variable or a same-named local function is told apart from the binding an
 * oracle is about.
 */

import { join } from 'node:path';

import * as ts from 'typescript';

/** One file to compile from memory. */
interface IMemoryFile {
  readonly path: string;
  readonly text: string;
}

/** The compiler's own `getSourceFile`. */
type SourceReader = ts.CompilerHost['getSourceFile'];

/**
 * One path spelling for every platform: the compiler asks with `/`.
 *
 * @param path - A path.
 * @returns The path with `/` separators.
 */
function slashed(path: string): string {
  return path.replaceAll('\\', '/');
}

/**
 * A source reader that serves the in-memory files and leaves the rest to disk.
 *
 * @param texts - In-memory text by slashed path.
 * @param fromDisk - The compiler's own reader.
 * @returns The combined reader.
 */
function memoryReader(texts: ReadonlyMap<string, string>, fromDisk: SourceReader): SourceReader {
  return (name, version, ...rest) => {
    const key = slashed(name);
    const text = texts.get(key);
    if (text === undefined) return fromDisk(name, version, ...rest);
    return ts.createSourceFile(name, text, version, true);
  };
}

/**
 * A file check that sees the in-memory files and leaves the rest to disk.
 *
 * @param texts - In-memory text by slashed path.
 * @param onDisk - The compiler's own check.
 * @returns The combined check.
 */
function memoryExists(
  texts: ReadonlyMap<string, string>,
  onDisk: (name: string) => boolean,
): (name: string) => boolean {
  return name => {
    const key = slashed(name);
    return texts.has(key) || onDisk(name);
  };
}

/**
 * A compiler host that sees the in-memory files as if they were on disk.
 *
 * @param files - The in-memory files.
 * @param options - Compiler options.
 * @returns The host.
 */
function memoryHost(files: readonly IMemoryFile[], options: ts.CompilerOptions): ts.CompilerHost {
  const host = ts.createCompilerHost(options, true);
  const entries = files.map(file => [slashed(file.path), file.text] as const);
  const texts = new Map(entries);
  const onDisk = host.fileExists.bind(host);
  const fromDisk = host.getSourceFile.bind(host);
  const fileExists = memoryExists(texts, onDisk);
  const getSourceFile = memoryReader(texts, fromDisk);
  return { ...host, fileExists, getSourceFile };
}

/**
 * A program whose root files are held in memory.
 *
 * @param files - The root files, by absolute path.
 * @param options - Compiler options.
 * @returns The program.
 */
function programOf(files: readonly IMemoryFile[], options: ts.CompilerOptions): ts.Program {
  const host = memoryHost(files, options);
  const roots = files.map(file => file.path);
  return ts.createProgram(roots, options, host);
}

/**
 * Stop on a tsconfig the compiler cannot read at all.
 *
 * @param diagnostic - Why.
 * @returns Never; always throws.
 */
function failConfig(diagnostic: ts.Diagnostic): never {
  const message = ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n');
  throw new RangeError(`tsconfig.json: ${message}`);
}

/**
 * The repo's own compiler options, so imports resolve as they do in the build.
 *
 * @param root - The repo root.
 * @returns The options from `tsconfig.json`; throws when it cannot be read.
 */
function repoCompilerOptions(root: string): ts.CompilerOptions {
  const configPath = join(root, 'tsconfig.json');
  const host: ts.ParseConfigFileHost = {
    ...ts.sys,
    onUnRecoverableConfigFileDiagnostic: failConfig,
  };
  const parsed = ts.getParsedCommandLineOfConfigFile(configPath, {}, host);
  if (parsed === undefined) throw new RangeError(`cannot read ${configPath}`);
  return parsed.options;
}

/**
 * Whether two names refer to the same binding.
 *
 * @param checker - The program's checker.
 * @param use - A name where it is used.
 * @param declared - The name where the binding is declared.
 * @returns True when both resolve to one symbol.
 */
function isSameBinding(checker: ts.TypeChecker, use: ts.Node, declared: ts.Node): boolean {
  const symbol = checker.getSymbolAtLocation(use);
  return symbol !== undefined && symbol === checker.getSymbolAtLocation(declared);
}

export type { IMemoryFile };
export { isSameBinding, programOf, repoCompilerOptions };
