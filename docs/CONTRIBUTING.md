# Contributing

## Development Setup

```bash
git clone https://github.com/4sukeSuzuki/ai-auto-dev-framework
cd ai-auto-dev-framework
npm install   # also runs lefthook install via prepare script
```

## Workflow

1. Check existing issues or create a new one.
2. Create a branch: `feature/#<issue>-<description>` (see [branching strategy](agent-guides/branching-strategy.md)).
3. Implement using the skills in `.claude/skills/`.
4. Run `npm run lint && npm run typecheck && npm run test && npm run build` — all must pass.
5. Create a PR using the `.github/pull_request_template.md`.
6. Wait for review and CI green.

## Code Standards

See [core-conventions.md](agent-guides/core-conventions.md) for TypeScript, Biome, and Vitest conventions.

## Commit Messages

Follow [Conventional Commits](https://www.conventionalcommits.org/):

```
feat(auth): add JWT refresh token support
fix(api): handle null response from upstream
```

Types: `feat` `fix` `chore` `refactor` `docs` `test` `style` `ci` `perf`

## Security

If you discover a security vulnerability, **do not** open a public issue.  
Contact the maintainers directly via GitHub private vulnerability reporting.

See [security-policy.md](agent-guides/security-policy.md) for details.

## License

By contributing, you agree that your contributions will be licensed under the MIT License.
