// Canary: `child_process.spawn(..., { detached: true })` MUST be
// followed by `.unref()` so the parent's event-loop handle on the
// child is released. Without it, Node tests / scripts hang at exit
// waiting for the detached child to die. Locks CodeRabbit F9 on
// PR #235: the Camoufox Xvfb spawn in the Jest mock was missing
// `.unref()` and `--forceExit` was masking the hang.
//
// `verify.sh` fails the build if this canary stops triggering.
import { spawn } from 'node:child_process';
const proc = spawn('sleep', ['0.1'], { detached: true });

export { proc };
