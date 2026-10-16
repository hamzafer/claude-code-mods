// Current state + picks + scope -> actions -> shell lines.
import { realpathSync } from 'node:fs';
import { resolve } from 'node:path';

export const MARKET = 'claude-code-mods';
export const MARKET_REPO = 'hamzafer/claude-code-mods';

// Same folder after symlinks and slashes; case-blind on Windows.
function samePath(a, b) {
  const norm = (p) => {
    let r = resolve(p);
    try { r = realpathSync(r); } catch {}
    return process.platform === 'win32' ? r.toLowerCase() : r;
  };
  return norm(a) === norm(b);
}

// `claude plugin list --json` -> { name: { enabled, scope } } for our mods in the chosen scope.
// A community mod counts when it comes from its own marketplace, and keeps that name.
// Project scope means project or local entries for this folder.
export function readState(list, { scope, cwd, community = [] }) {
  const state = {};
  for (const p of list) {
    const [name, market] = String(p.id).split('@');
    const theirs = market !== MARKET && community.some((c) => c.name === name && c.marketplace === market);
    if (market !== MARKET && !theirs) continue;
    const ok = scope === 'user'
      ? p.scope === 'user'
      : (p.scope === 'project' || p.scope === 'local') && (!p.projectPath || samePath(p.projectPath, cwd));
    if (ok) state[name] = { enabled: !!p.enabled, scope: p.scope, ...(theirs ? { marketplace: market } : {}) };
  }
  return state;
}

// Never uninstalls. Enable and disable use the scope the mod is installed in.
// Only disables mods in the current catalog, so a retired mod is left alone.
// Community mods carry their own marketplace (`market`); ours leave it out.
// markets: the marketplace names claude has; without it, only ours is checked (hasMarketplace).
export function planActions({ state, picked, scope, hasMarketplace = true, catalog, community = [], markets }) {
  const theirs = (name) => community.find((c) => c.name === name);
  const at = (market) => (market ? { market } : {});
  const install = [], enable = [], disable = [];
  for (const name of picked) {
    const s = state[name];
    if (!s) install.push({ verb: 'install', name, scope, ...at(theirs(name)?.marketplace) });
    else if (!s.enabled) enable.push({ verb: 'enable', name, scope: s.scope, ...at(s.marketplace) });
  }
  for (const [name, s] of Object.entries(state)) {
    if (s.enabled && !picked.includes(name) && (!catalog || catalog.includes(name))) {
      disable.push({ verb: 'disable', name, scope: s.scope, ...at(s.marketplace) });
    }
  }
  // Each marketplace a mod turns on from, once: added when missing, else refreshed,
  // since a stale clone would install old versions.
  const has = (m) => (markets ? markets.includes(m) : m === MARKET ? hasMarketplace : true);
  const market = [...new Set([...install, ...enable].map((a) => a.market || MARKET))].map((m) => {
    if (m === MARKET) return has(m) ? { verb: 'refresh' } : { verb: 'marketplace' };
    return has(m) ? { verb: 'refresh', market: m } : { verb: 'marketplace', market: m, repo: community.find((c) => c.marketplace === m).repo };
  });
  return [...market, ...install, ...enable, ...disable];
}

export function toArgs(a) {
  if (a.verb === 'marketplace') return ['plugin', 'marketplace', 'add', a.repo || MARKET_REPO];
  if (a.verb === 'refresh') return ['plugin', 'marketplace', 'update', a.market || MARKET];
  return ['plugin', a.verb, `${a.name}@${a.market || MARKET}`, '--scope', a.scope];
}

export function toShell(a) {
  return ['claude', ...toArgs(a)].join(' ');
}
