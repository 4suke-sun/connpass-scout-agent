# Branching Strategy (GitHub Flow)

## Branch Model

```
main ──────────────────────────────────── (always deployable)
  └── feature/#123-add-auth ──── squash → main
  └── fix/#456-null-check    ──── squash → main
  └── chore/update-deps      ──── squash → main
```

## Branch Types

| Prefix | Purpose |
|--------|---------|
| `feature/` | New functionality |
| `fix/` | Bug fix |
| `hotfix/` | Emergency production fix |
| `refactor/` | Code restructuring (no behavior change) |
| `docs/` | Documentation only |
| `test/` | Tests only |
| `chore/` | Tooling, deps, config |
| `ci/` | CI/CD changes |

## Branch Naming

Format: `<prefix>/#<issue-number>-<kebab-case-description>`

Examples:
- `feature/#42-user-authentication`
- `fix/#99-null-pointer-in-parser`
- `chore/update-biome-config`

## Merge Strategy

- **Squash merge only** — keeps main history clean.
- Delete branch after merge.
- Never merge `main` into a feature branch — rebase instead.

## Direct Push to Main

Prohibited. Branch Protection enforces this. All changes go through PRs.
