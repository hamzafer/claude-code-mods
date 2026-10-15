# claude-code-mods

## Agent skills

### Issue tracker

Issues live in this repo's GitHub Issues, used through the `gh` CLI. See `docs/agents/issue-tracker.md`.

### Triage labels

The five default labels: `needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, `wontfix`. See `docs/agents/triage-labels.md`.

### Domain docs

Single-context: one `GLOSSARY.md` and `docs/adr/` at the repo root, created when needed. See `docs/agents/domain.md`.

## Releasing the CLI

Bump `cli/package.json`'s version in a PR. When it merges to main, `.github/workflows/publish-cli.yml` publishes it to npm (trusted publishing, no token). A version npm already has is skipped.
