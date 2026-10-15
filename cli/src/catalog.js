// Load and normalize the mod list, group by category.
import { readFile as fsReadFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

export const LIVE_URL =
  'https://raw.githubusercontent.com/hamzafer/claude-code-mods/main/.claude-plugin/marketplace.json';

// Bundled copy (made by prepack), then the repo's own when run from a clone.
export const FALLBACKS = [
  fileURLToPath(new URL('../marketplace.json', import.meta.url)),
  fileURLToPath(new URL('../../.claude-plugin/marketplace.json', import.meta.url)),
];

// README order. Anything else lands in Other, last.
export const CATEGORIES = [
  'See what\'s happening',
  'Guard your repo',
  'Spend less',
  'My setup (fork and adapt)',
  'For fun',
];

export async function loadCatalog({
  fetch = globalThis.fetch,
  readFile = fsReadFile,
  fallbacks = FALLBACKS,
  timeoutMs = 3000,
} = {}) {
  try {
    const res = await fetch(LIVE_URL, { signal: AbortSignal.timeout(timeoutMs) });
    if (res.ok) return normalize(await res.json());
  } catch {}
  for (const path of fallbacks) {
    try {
      return normalize(JSON.parse(await readFile(path, 'utf8')));
    } catch {}
  }
  throw new Error('Could not load the mod list (offline, and no local copy).');
}

// Live text goes to the terminal: keep strings only, no control characters (no ANSI injection).
export const clean = (v) => typeof v === 'string' || typeof v === 'number'
  ? String(v).replace(/[\t\n\r]/g, ' ').replace(/[\x00-\x1f\x7f-\x9f]/g, '') : '';
export const cleanList = (v) => (Array.isArray(v) ? v.filter((x) => typeof x === 'string').map(clean).filter(Boolean) : []);

// Names go into claude args (a shell on Windows) and URLs, so only plain ones pass.
export const NAME = /^[a-z0-9][a-z0-9._-]*$/;

// One mod with every field a clean string or string list.
export const tidy = (p) => ({
  name: clean(p.name),
  description: clean(p.description),
  source: typeof p.source === 'string' ? p.source : undefined,
  category: clean(p.category) || 'Other',
  tags: cleanList(p.tags),
  needs: cleanList(p.needs),
});

export function normalize(market) {
  const plugins = Array.isArray(market?.plugins) ? market.plugins : [];
  return plugins.filter((p) => typeof p?.name === 'string' && NAME.test(p.name)).map(tidy);
}

export function groupByCategory(mods) {
  const order = [...CATEGORIES, ...new Set(mods.map((m) => m.category).filter((c) => !CATEGORIES.includes(c) && c !== 'Other')), 'Other'];
  return order
    .map((category) => ({ category, mods: mods.filter((m) => m.category === category) }))
    .filter((g) => g.mods.length);
}
