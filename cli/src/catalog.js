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

export function normalize(market) {
  return (market.plugins || []).map((p) => ({
    name: p.name,
    description: p.description || '',
    source: p.source,
    category: p.category || 'Other',
    tags: p.tags || [],
    needs: p.needs || [],
  }));
}

export function groupByCategory(mods) {
  const order = [...CATEGORIES, ...new Set(mods.map((m) => m.category).filter((c) => !CATEGORIES.includes(c) && c !== 'Other')), 'Other'];
  return order
    .map((category) => ({ category, mods: mods.filter((m) => m.category === category) }))
    .filter((g) => g.mods.length);
}
