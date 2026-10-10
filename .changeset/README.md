# Changesets

Version `better-glimm` with changesets. Apps in `apps/` are private and ignored.

```bash
# describe a change (creates .changeset/<name>.md)
pnpm changeset

# bump versions + changelogs from pending changesets
pnpm version-packages

# publish release/* tag + GitHub release (runs checks first)
pnpm publish:release -- patch   # or minor | major | --version 0.2.0
```

CI publishes to npm only on `workflow_dispatch` or a `release-*` tag.
