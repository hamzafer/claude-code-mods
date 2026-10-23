## What changed

## Checklist

- [ ] `claude plugin validate mods/<name>` passes
- [ ] `claude plugin test mods/<name>` passes
- [ ] `node --test test/*.test.mjs` and `cd cli && node --test` pass
- [ ] Changed a mod: version bumped in its `plugin.json`, in `.claude-plugin/marketplace.json` and on its site page (chip and JSON-LD)
- [ ] New mod: `mods/<name>/` and an entry in `.claude-plugin/marketplace.json`
- [ ] New mod: README table row and `docs/mods.md` notes
- [ ] New mod: `site/mods/<name>/index.html`, a row and JSON-LD entry in `site/index.html`, the "All N mods" counts updated, and a `site/sitemap.xml` entry
- [ ] New mod: a screenshot in `images/` (and `site/images/`)
- [ ] New band mod: `shared/bands.ts` copied to `mods/<name>/hooks/bands.ts`
- [ ] Community mod: a README row and a `community.json` entry
