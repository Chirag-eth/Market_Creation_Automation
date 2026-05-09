# Code Review Process

## Scope

All production code, test code, and CI/configuration changes require pull-request review.

## Required Checks Before Review

Run locally before requesting review:

```bash
npm run lint
npm run format:check
npm test
```

## Pull Request Requirements

Each PR should include:

1. Clear problem statement and change summary
2. Risk assessment (runtime, data, auth/security, performance)
3. Test evidence (new/updated tests plus command outputs)
4. Rollback plan for risky changes

## Review Rules

1. Minimum one reviewer approval for standard changes
2. Minimum two approvals for authentication, publishing, or environment-routing changes
3. No self-approval merges
4. All CI checks must pass

## Severity Levels for Findings

- `P0`: Release-blocking, data-loss/security-critical issues
- `P1`: High-impact correctness/regression risk
- `P2`: Medium-impact maintainability/UX/edge-case issue
- `P3`: Minor quality improvements

## Reviewer Checklist

- Correctness against requirements
- Backward compatibility and migration impact
- Authentication/authorization safety
- Error handling and observability
- Test quality and coverage deltas
- Naming, readability, and architectural fit (MVC boundaries)

## Merge Criteria

A PR can merge only when:

1. Required approvals are complete
2. All requested changes are resolved
3. CI is green
4. Release notes/change summary is present
