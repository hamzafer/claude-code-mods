// The only place that runs `claude`. Tests swap in a fake run().
import { spawn } from 'node:child_process';

export function makeRunner(bin = 'claude') {
  return (args, { input } = {}) =>
    new Promise((resolve, reject) => {
      // Windows installs claude as a .cmd shim, which needs a shell.
      const child = spawn(bin, args, { shell: process.platform === 'win32' });
      let stdout = '', stderr = '';
      child.stdout.on('data', (d) => (stdout += d));
      child.stderr.on('data', (d) => (stderr += d));
      child.on('error', reject);
      child.on('close', (code) => resolve({ code, stdout, stderr }));
      child.stdin.end(input ?? '');
    });
}

export const run = makeRunner();
