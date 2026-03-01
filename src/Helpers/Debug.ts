import debug, { type Debugger } from 'debug';

export function getDebug(name: string): Debugger {
  return debug(`israeli-bank-scrapers:${name}`);
}
