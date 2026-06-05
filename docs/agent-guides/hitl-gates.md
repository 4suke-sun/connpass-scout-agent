# Human-in-the-Loop (HITL) Gates

These are the points where AI **must stop and wait** for human confirmation before proceeding.

## Gate 1: Plan Approval

**When**: Before implementing any non-trivial change.
**What**: Show the drafted plan (goal, acceptance criteria, scope, risks, steps).
**Action**: Do not write code until human replies "approved" or provides corrections.

## Gate 2: Authentication Required

**When**: `gh auth status` shows unauthenticated, or any external service login is needed.
**What**: Report the authentication state.
**Action**: Ask the human to authenticate. Do not attempt to handle credentials.

## Gate 3: CLAUDE.md Draft Review

**When**: CLAUDE.md is created or significantly modified.
**What**: Show the full content (must be ≤100 lines).
**Action**: Wait for human confirmation that tone and content are correct.

## Gate 4: CI Failure

**When**: Any of lint / typecheck / test / build fails.
**What**: Report the exact error output.
**Action**: Do not push. Do not auto-fix without reporting first. Ask for guidance.

## Gate 5: PR Merge

**When**: A PR is created.
**What**: Report the PR URL.
**Action**: **Never merge.** The human reviewer merges via GitHub UI after review.

## Gate 6: Branch Protection Verification

**When**: After applying Branch Protection rules.
**What**: Report the applied rules.
**Action**: Ask the human to verify that direct push to main is rejected.

## Additional Gates

- Destructive git operations (force push, reset --hard) → always blocked by hook, require explicit human override
- Secret found in history → stop immediately, escalate to human
- New dependency with unclear license → ask before adding
