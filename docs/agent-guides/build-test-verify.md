# Build, Test, and Verify

## Standard Flow

Every change must pass this sequence before pushing:

```bash
npm run lint          # Biome lint + format check
npm run typecheck     # TypeScript strict mode
npm run test          # Vitest unit tests
npm run test:coverage # Coverage report (lines ≥50%, branches ≥40%)
npm run build         # TypeScript compilation
```

## Coverage Thresholds

| Metric | Threshold | Target (Q+1) |
|--------|-----------|--------------|
| Lines | 50% | 60% |
| Statements | 50% | 60% |
| Branches | 40% | 50% |
| Functions | 50% | 60% |

Thresholds increase by ~10% per quarter. Update `vitest.config.ts` when raising.

## Failing Checks

- **Never push** when any check fails.
- Fix the root cause — do not suppress warnings.
- If flaky tests block you, isolate and skip with `test.skip` + a TODO comment (and create a tracking issue).

## Build Artifacts

Build output goes to `dist/`. It is gitignored and generated fresh in CI.
