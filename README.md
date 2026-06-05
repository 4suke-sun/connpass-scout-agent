# ai-auto-dev-framework

> **⚠️ Experimental — Not recommended for production use**
>
> This repository is published for research and validation purposes, exploring how to safely run AI agents (Claude Code) in auto-mode.
> Adopt at your own risk after thorough evaluation. Specifications and structure may change without notice.

**[日本語版 README はこちら](docs/README.ja.md)**

---

A "development constitution" template repository aiming for zero incidents when running Claude Code in auto-mode.
Use this as a starting point for new projects — CI, hooks, and skills are ready from day one.

## What's Included

| Layer | Location | Purpose |
|-------|----------|---------|
| Guard hooks | `.claude/hooks/` | Block dangerous operations in real time |
| Skills | `.claude/skills/` | Structured workflows with human approval gates |
| CI workflows | `.github/workflows/` | Automated quality and security gates |
| devcontainer | `.devcontainer/` | Isolated, reproducible dev environment |
| Agent guides | `docs/agent-guides/` | Detailed instructions for each phase |
| Constitution | `CLAUDE.md` | Rulebook the AI agent always references |

## Quick Start

### 1. Create a repo from this template

```bash
gh repo create my-project --template 4suke-sun/ai-auto-dev-framework --private
cd my-project
npm install
```

Or click **Use this template** on GitHub.

### 2. Customize for your project

| File | Action |
|------|--------|
| `src/` | Remove skeleton code, add your own |
| `package.json` | Update `name`, `description`, `version` |
| `CLAUDE.md` | Rewrite the "What (Project Map)" section |
| `.github/CODEOWNERS` | Set your team as reviewers |
| `tsconfig.json` | Adjust `target`, `lib` as needed |

### 3. Verify setup

```bash
npm run lint         # Biome lint
npm run typecheck    # TypeScript strict check
npm run test         # Vitest
npm run build        # Compile
```

All four must be green before any push.

### 4. Start developing

```
Launch Claude Code → It reads CLAUDE.md → Follows skills for each phase
```

### 5. Configure GitHub Settings (not inherited from template)

These settings are **not** copied when you create a repo from a template. Choose one method:

#### Option A: Using Claude Code (recommended)

Run the setup skill in your Claude Code session:

```
/setup-repository
```

This will automatically configure Code Scanning, branch protection, and auto-merge via `gh` CLI.

#### Option B: Manual setup via GitHub Web UI

| Setting | Path | Action |
|---------|------|--------|
| Code Scanning | Settings → Code security → Code scanning | Click "Setup → Default" to enable CodeQL |
| Branch protection | Settings → Branches → Add rule for `main` | Enable: Require PR, require status checks (Lint, Typecheck, Test & Coverage, Build), require CODEOWNERS review |
| Auto-merge | Settings → General → Pull Requests | Enable "Allow auto-merge" if you want dependabot auto-merge to work |

> **Note (Private repos on Free plan):** CodeQL and Gitleaks SARIF upload require GitHub Advanced Security, which is not available for private repos on the Free plan. These workflows will show warnings but won't block your CI. Consider removing `codeql.yml` or making your repo public if you need these features.

## Development Flow

```
Create issue
  ↓
Create feature branch from main (or dev)
  ↓
ask-if-underspecified skill (if requirements are unclear)
  ↓
plan skill → Wait for user approval
  ↓
implement skill (test-first)
  ↓
git-commit skill (Conventional Commits)
  ↓
self-review-checklist skill
  ↓
create-pull-request skill
  ↓
CI passes + Human review → Merge (human only)
```

## Key Conventions

- **Secrets**: Never hardcode. Use `.env` only. Enforced by 3 hook layers.
- **Commits**: [Conventional Commits](https://www.conventionalcommits.org/) — `type(scope): description`
- **Branches**: GitHub Flow — short-lived feature branches, squash merge to `main`.
- **Coverage**: Lines ≥50% / Branches ≥40% (raised quarterly).
- **Merges**: Human-only. AI never merges PRs.

## Human-in-the-Loop Gates

Auto-mode stops at these points and waits for human approval:

1. Plan approval before implementation
2. Authentication (gh, cloud CLIs)
3. CLAUDE.md review after creation
4. Any CI failure
5. PR merge (always human)
6. Branch protection verification

See [docs/agent-guides/hitl-gates.md](docs/agent-guides/hitl-gates.md) for details.

## Security

| Hook | Trigger | Purpose |
|------|---------|---------|
| `scan-secrets.sh` | UserPromptSubmit | Block secrets in prompts |
| `scan-commit.sh` | PreToolUse | Block secrets in staged changes |
| `block-dangerous-git.sh` | PreToolUse | Block force-push, reset --hard, etc. |
| `prompt-injection-defender.sh` | PostToolUse | Warn on injection patterns in tool output |
| `check-package-hallucination.sh` | PreToolUse | Block install of non-existent packages |
| `gitleaks` | CI | Full history secret scan |

## CI Workflows

| Workflow | What it does | Trigger |
|----------|-------------|---------|
| CI | Lint / Typecheck / Test & Coverage / Build | PR + main push |
| CodeQL | Static security analysis | PR + main push + weekly |
| Gitleaks | Secret scan | PR + main push |
| License Check | Detect GPL/AGPL | package.json changes |
| Security Review | npm audit (high+) | PR + main push + weekly |
| Auto-merge Dependabot | Auto squash merge patch only | dependabot PRs |

## Customization Guide

### Installing into an existing repository

Already have a project and want to add the guardrails?

#### Quick install (one line)

```bash
curl -fsSL https://raw.githubusercontent.com/4suke-sun/ai-auto-dev-framework/main/scripts/install.sh | bash
```

#### Manual install (if you prefer to see what's happening)

```bash
# Fetch framework files (no clone, no history)
git remote add framework https://github.com/4suke-sun/ai-auto-dev-framework.git
git fetch framework main

# Copy guardrail files into your project
git checkout framework/main -- .claude/ CLAUDE.md .editorconfig .gitleaks.toml
git checkout framework/main -- .github/workflows/gitleaks.yml .github/workflows/codeql.yml
git checkout framework/main -- .github/workflows/security-review.yml .github/dependabot.yml
git checkout framework/main -- .github/CODEOWNERS .github/pull_request_template.md

# Clean up the temporary remote
git remote remove framework

# Commit
git add -A && git commit -m "chore: add ai-auto-dev-framework guardrails"
```

After installation, open Claude Code and ask it to run `setup-repository` to configure GitHub Settings.

See [.claude/skills/install-framework/SKILL.md](.claude/skills/install-framework/SKILL.md) for the full procedure including customization steps.

### Adding/removing CI jobs

Edit `.github/workflows/ci.yml`. Update required checks in GitHub Settings → Branch protection accordingly.

### Adding a new skill

Create `.claude/skills/<skill-name>/SKILL.md` and add it to the skill invocation table in `CLAUDE.md`.

### Using with a different language

Remove `src/`, `tsconfig.json`, `biome.json` and replace with your language's toolchain.
Update `npm run` commands in CI. `.claude/skills/` and `CLAUDE.md` work as-is.

## License

MIT — see [LICENSE](LICENSE).

Third-party licenses: [THIRD_PARTY_LICENSES.json](THIRD_PARTY_LICENSES.json)
