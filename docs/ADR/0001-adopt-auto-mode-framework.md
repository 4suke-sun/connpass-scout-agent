# ADR 0001: Adopt Auto-Mode Safe Development Framework

**Status**: Accepted  
**Date**: 2026-05-24  
**Deciders**: Repository maintainers

## Context

Claude Code's auto-mode enables continuous AI-driven development with minimal human intervention. Without guardrails, this creates risks:

- Secrets committed to version control
- Destructive git operations executed autonomously
- Dependencies with incompatible licenses introduced silently
- Prompt injection attacks through external content
- Hallucinated package names installed

We need a framework that makes auto-mode operation as safe as running with a human in the loop.

## Decision

Adopt a three-layer safety architecture:

1. **Hook layer** (`.claude/hooks/`): Shell scripts that run synchronously before/after tool use, blocking dangerous operations in real time.
2. **Skill layer** (`.claude/skills/`): Structured workflows that enforce human approval at key decision points.
3. **CI layer** (`.github/workflows/`): Automated gates that must pass before any merge.

Key technology choices:
- **Biome** over ESLint+Prettier: single tool, faster, less configuration drift.
- **Vitest** over Jest: ESM-native, faster, compatible with TypeScript strict mode.
- **lefthook** over husky: faster, simpler configuration, cross-platform.
- **GitHub Flow** over Gitflow: simpler, fewer long-lived branches, faster iteration.

## Consequences

**Positive**:
- Secrets are blocked at three independent layers (prompt → commit → CI).
- Destructive operations require explicit human override.
- Every dependency has a verified license.
- CI green is a hard requirement for merge.

**Negative**:
- Higher initial setup cost.
- Package hallucination check adds latency to `npm install` / `pip install`.
- Coverage thresholds must be raised quarterly (operational overhead).

## Review

This ADR should be revisited when:
- Coverage targets reach 80% (consider 90% target)
- Team size grows beyond 5 (revisit CODEOWNERS and required reviewers)
- A new language is added to the stack
