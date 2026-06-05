# Core Conventions

## TypeScript

- `strict: true` in tsconfig.json — always.
- No `any`. Use `unknown` + type narrowing.
- No `@ts-ignore` or `@ts-expect-error` without a comment explaining why.
- ESNext target, `type: "module"` in package.json.
- Node.js 20+.

## Biome

Biome handles both linting and formatting. No ESLint, no Prettier.

```bash
npm run lint          # Check only
npm run lint:fix      # Auto-fix
npm run format        # Format all files
npm run check         # Lint + format + fix
```

Key settings (biome.json):
- Indent: 2 spaces
- Semicolons: required
- Quotes: double
- Line width: 119

## Vitest

- Test files: `src/**/*.test.ts`
- Test names: Japanese, format `前提条件_期待結果`
- Use `describe` blocks for grouping
- Avoid mocking internal modules — prefer dependency injection
- AWS SDK mocks: `aws-sdk-client-mock`

## Naming

| Item | Convention |
|------|-----------|
| Files | `kebab-case.ts` |
| Functions | `camelCase` |
| Classes | `PascalCase` |
| Constants | `SCREAMING_SNAKE_CASE` |
| Types/Interfaces | `PascalCase` |

## Comments

Write comments only for non-obvious WHY. Never explain WHAT the code does.
