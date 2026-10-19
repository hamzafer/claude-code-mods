// Tool checks for a mod's needs. Only some needs can be checked; the rest are shown only.
import { accessSync, constants } from 'node:fs';
import { posix, win32 } from 'node:path';

const ON_PATH = new Set(['gh', 'codex', 'node', 'unpause']);

// Pure Node PATH lookup, no `which` subprocess.
export function onPath(cmd, {
  path = process.env.PATH,
  pathext = process.env.PATHEXT,
  platform = process.platform,
  access = (p) => accessSync(p, platform === 'win32' ? constants.F_OK : constants.X_OK),
} = {}) {
  const win = platform === 'win32';
  const [delimiter, join] = win ? [';', win32.join] : [':', posix.join];
  const exts = win ? ['', ...(pathext || '.COM;.EXE;.BAT;.CMD').split(';').filter(Boolean)] : [''];
  for (const dir of (path || '').split(delimiter).filter(Boolean)) {
    for (const ext of exts) {
      try {
        access(join(dir, cmd + ext));
        return true;
      } catch {}
    }
  }
  return false;
}

// The needs that are checkable and not met.
export function missing(needs = [], { which = onPath, platform = process.platform } = {}) {
  return (needs || []).filter((n) => {
    if (n.toLowerCase() === 'macos') return platform !== 'darwin';
    return ON_PATH.has(n) && !which(n);
  });
}

// One line for the detail box, or null when nothing is missing.
export function warning(name, gone) {
  const tools = gone.filter((n) => n.toLowerCase() !== 'macos');
  const mac = tools.length < gone.length;
  if (!gone.length) return null;
  if (mac) return `${name} needs macOS: it won't work on this system${tools.length ? `. ${tools.join(', ')} not found` : ''}`;
  return `${tools.join(', ')} not found: ${name} won't work until you install ${tools.length > 1 ? 'them' : 'it'}`;
}
