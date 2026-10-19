// Screenshot lookup on GitHub and opening it in the browser.
import { spawn as nodeSpawn } from 'node:child_process';

const IMAGES = 'https://raw.githubusercontent.com/hamzafer/claude-code-mods/main/images/';

export const imageUrl = (name, ext) => `${IMAGES}${name}.${ext}`;

// HEAD for .png, then .gif. Null when neither exists or the network fails.
export async function findImage(name, { fetch = globalThis.fetch, timeoutMs = 3000 } = {}) {
  for (const ext of ['png', 'gif']) {
    const url = imageUrl(name, ext);
    try {
      const res = await fetch(url, { method: 'HEAD', signal: AbortSignal.timeout(timeoutMs) });
      if (res.ok) return url;
    } catch {}
  }
  return null;
}

export function openCommand(url, platform = process.platform) {
  if (platform === 'darwin') return ['open', [url]];
  if (platform === 'win32') return ['cmd', ['/c', 'start', '""', url]];
  return ['xdg-open', [url]];
}

// Fire and forget; a missing opener is not worth a crash.
export function openUrl(url, { spawn = nodeSpawn, platform = process.platform } = {}) {
  const [cmd, args] = openCommand(url, platform);
  try {
    const child = spawn(cmd, args, { detached: true, stdio: 'ignore', windowsVerbatimArguments: platform === 'win32' });
    child.on('error', () => {});
    child.unref();
  } catch {}
}

export async function preview(name, { fetch, spawn, platform, timeoutMs } = {}) {
  const url = await findImage(name, { fetch, timeoutMs });
  if (!url) return { message: 'No image yet' };
  openUrl(url, { spawn, platform });
  return { message: 'Opened the screenshot' };
}
