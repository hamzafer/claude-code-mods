// The only place that runs `claude`. Tests swap in a fake run().
import { spawn } from 'node:child_process';

// A hung claude is killed after this long and counts as a failure.
export const TIMEOUT_MS = 10 * 60 * 1000;

export function makeRunner(bin = 'claude', { timeoutMs = TIMEOUT_MS } = {}) {
  return (args, { input } = {}) =>
    new Promise((resolve, reject) => {
      // Windows installs claude as a .cmd shim, which needs a shell.
      const child = spawn(bin, args, { shell: process.platform === 'win32' });
      let stdout = '', stderr = '', timedOut = false;
      const timer = setTimeout(() => { timedOut = true; child.kill('SIGKILL'); }, timeoutMs);
      child.stdout.on('data', (d) => (stdout += d));
      child.stderr.on('data', (d) => (stderr += d));
      child.on('error', (e) => { clearTimeout(timer); reject(e); });
      child.on('close', (code) => {
        clearTimeout(timer);
        if (timedOut) return resolve({ code: code || 1, stdout, stderr: `timed out after ${Math.round(timeoutMs / 1000)}s\n${stderr}` });
        resolve({ code, stdout, stderr });
      });
      // The child may exit before reading its input (EPIPE); its exit code tells the story.
      child.stdin.on('error', () => {});
      child.stdin.end(input ?? '');
    });
}

export const run = makeRunner();
