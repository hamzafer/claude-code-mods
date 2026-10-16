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

// Other people's mods, each in its own marketplace. Same live-then-bundled loading.
export const COMMUNITY_URL =
  'https://raw.githubusercontent.com/hamzafer/claude-code-mods/main/community.json';
export const COMMUNITY_FALLBACKS = [
  fileURLToPath(new URL('../community.json', import.meta.url)),
  fileURLToPath(new URL('../../community.json', import.meta.url)),
];
export const COMMUNITY = 'Community (not maintained here)';

// README order. Anything else lands in Other, last.
export const CATEGORIES = [
  'See what\'s happening',
  'Guard your repo',
  'Spend less',
  'My setup (fork and adapt)',
  'For fun',
];

// The live file, then each fallback; null when none loads.
async function loadJson(url, { fetch, readFile, fallbacks, timeoutMs }) {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) });
    if (res.ok) return await res.json();
  } catch {}
  for (const path of fallbacks) {
    try {
      return JSON.parse(await readFile(path, 'utf8'));
    } catch {}
  }
  return null;
}

export async function loadCatalog({
  fetch = globalThis.fetch,
  readFile = fsReadFile,
  fallbacks = FALLBACKS,
  timeoutMs = 3000,
} = {}) {
  const market = await loadJson(LIVE_URL, { fetch, readFile, fallbacks, timeoutMs });
  if (!market) throw new Error('Could not load the mod list (offline, and no local copy).');
  return normalize(market);
}

// Never fails: no community list just means no community mods.
export async function loadCommunity({
  fetch = globalThis.fetch,
  readFile = fsReadFile,
  fallbacks = COMMUNITY_FALLBACKS,
  timeoutMs = 3000,
} = {}) {
  return normalizeCommunity(await loadJson(COMMUNITY_URL, { fetch, readFile, fallbacks, timeoutMs }));
}

// Ours, then the community mods whose names are free.
export async function loadAll({ loadCatalog: ours = loadCatalog, loadCommunity: theirs = loadCommunity } = {}) {
  const [mods, community] = await Promise.all([ours(), theirs().catch(() => [])]);
  const taken = new Set(mods.map((m) => m.name));
  return [...mods, ...community.filter((m) => !taken.has(m.name))];
}

// Live text goes to the terminal: keep strings only, no control characters (no ANSI injection).
export const clean = (v) => typeof v === 'string' || typeof v === 'number'
  ? String(v).replace(/[\t\n\r]/g, ' ').replace(/[\x00-\x1f\x7f-\x9f]/g, '') : '';
export const cleanList = (v) => (Array.isArray(v) ? v.filter((x) => typeof x === 'string').map(clean).filter(Boolean) : []);

// Names go into claude args (a shell on Windows) and URLs, so only plain ones pass.
export const NAME = /^[a-z0-9][a-z0-9._-]*$/;
// The same for a community mod's marketplace, GitHub user and repo.
export const MARKET_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;
export const USER = /^[A-Za-z0-9][A-Za-z0-9-]*$/;
export const REPO = /^[A-Za-z0-9][A-Za-z0-9-]*\/[A-Za-z0-9._-]+$/;

// One mod with every field a clean string or string list.
export const tidy = (p) => ({
  name: clean(p.name),
  description: clean(p.description),
  source: typeof p.source === 'string' ? p.source : undefined,
  category: clean(p.category) || 'Other',
  tags: cleanList(p.tags),
  needs: cleanList(p.needs),
  // Community mods also say where they come from.
  ...(p.marketplace ? {
    marketplace: clean(p.marketplace), repo: clean(p.repo), author: clean(p.author), url: clean(p.url),
  } : {}),
});

export function normalize(market) {
  const plugins = Array.isArray(market?.plugins) ? market.plugins : [];
  return plugins.filter((p) => typeof p?.name === 'string' && NAME.test(p.name)).map(tidy);
}

const str = (v) => typeof v === 'string';

export function normalizeCommunity(list) {
  const mods = Array.isArray(list?.mods) ? list.mods : [];
  return mods
    .filter((m) => str(m?.name) && NAME.test(m.name)
      && str(m.marketplace) && MARKET_NAME.test(m.marketplace)
      && str(m.repo) && REPO.test(m.repo)
      && str(m.author) && USER.test(m.author)
      && str(m.url) && m.url.startsWith('https://github.com/'))
    .map((m) => tidy({ ...m, source: undefined, category: COMMUNITY, needs: [] }));
}

// README order, then any others, Other, and the community mods last.
export function groupByCategory(mods) {
  const known = [...CATEGORIES, 'Other', COMMUNITY];
  const order = [...CATEGORIES, ...new Set(mods.map((m) => m.category).filter((c) => !known.includes(c))), 'Other', COMMUNITY];
  return order
    .map((category) => ({ category, mods: mods.filter((m) => m.category === category) }))
    .filter((g) => g.mods.length);
}
