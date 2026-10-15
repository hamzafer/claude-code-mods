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
// Project scope means project or local entries for this folder.
export function readState(list, { scope, cwd }) {
  const state = {};
  for (const p of list) {
    const [name, market] = String(p.id).split('@');
    if (market !== MARKET) continue;
    const ok = scope === 'user'
      ? p.scope === 'user'
      : (p.scope === 'project' || p.scope === 'local') && (!p.projectPath || samePath(p.projectPath, cwd));
    if (ok) state[name] = { enabled: !!p.enabled, scope: p.scope };
  }
  return state;
}

// Never uninstalls. Enable and disable use the scope the mod is installed in.
// Only disables mods in the current catalog, so a retired mod is left alone.
export function planActions({ state, picked, scope, hasMarketplace = true, catalog }) {
  const install = [], enable = [], disable = [];
  for (const name of picked) {
    const s = state[name];
    if (!s) install.push({ verb: 'install', name, scope });
    else if (!s.enabled) enable.push({ verb: 'enable', name, scope: s.scope });
  }
  for (const [name, s] of Object.entries(state)) {
    if (s.enabled && !picked.includes(name) && (!catalog || catalog.includes(name))) disable.push({ verb: 'disable', name, scope: s.scope });
  }
  const turnsOn = install.length + enable.length > 0;
  // A stale marketplace clone would install old versions, so refresh it first.
  const market = !turnsOn ? [] : hasMarketplace ? [{ verb: 'refresh' }] : [{ verb: 'marketplace' }];
  return [...market, ...install, ...enable, ...disable];
}

export function toArgs(a) {
  if (a.verb === 'marketplace') return ['plugin', 'marketplace', 'add', MARKET_REPO];
  if (a.verb === 'refresh') return ['plugin', 'marketplace', 'update', MARKET];
  return ['plugin', a.verb, `${a.name}@${MARKET}`, '--scope', a.scope];
}

export function toShell(a) {
  return ['claude', ...toArgs(a)].join(' ');
}
