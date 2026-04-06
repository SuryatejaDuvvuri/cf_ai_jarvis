# Code Review Guidelines

This document outlines our code review process and expectations.

## Review Goals

1. **Catch bugs** before they reach production
2. **Share knowledge** across the team
3. **Maintain code quality** and consistency
4. **Ensure security** best practices

## What to Look For

### Functionality

- Does the code do what it's supposed to do?
- Are edge cases handled?
- Are error conditions handled gracefully?

### Security

- No secrets or credentials in code
- Input validation on all external data
- Proper authentication/authorization checks
- SQL injection / XSS prevention

### Performance

- No obvious performance issues (N+1 queries, unnecessary loops)
- Appropriate use of async/await
- Memory leaks in event listeners or subscriptions

### Code Quality

- Clear, descriptive names for variables and functions
- Functions do one thing well
- No unnecessary complexity
- Comments explain "why", not "what"

### Testing

- New code has tests
- Tests cover the happy path and edge cases
- Tests are readable and maintainable

### Documentation

- Public APIs are documented
- Complex logic has explanatory comments
- README/docs updated if needed

## Review Process

### For Authors

1. **Self-review first**: Review your own PR before requesting reviews
2. **Keep PRs small**: Easier to review, faster to merge
3. **Write good descriptions**: Help reviewers understand context
4. **Respond promptly**: Address feedback within 24 hours

### For Reviewers

1. **Be constructive**: Suggest improvements, don't just criticize
2. **Be specific**: Point to exact lines, provide examples
3. **Distinguish blocking vs. non-blocking**: Use prefixes:
   - `[blocking]` - Must fix before merge
   - `[nit]` - Minor suggestion, author's discretion
   - `[question]` - Seeking clarification
4. **Approve when ready**: Don't hold up PRs for minor issues

## Comment Examples

**Good:**

```
[blocking] This function doesn't handle the case where `user` is null.
Consider adding a null check: `if (!user) return null;`
```

**Bad:**

```
This is wrong.
```

## Approval Requirements

- PRs require CI to pass
- PRs require 1 approval (increase to 2 as team grows)
- No direct pushes to `main`
- Squash merges for linear history

## Response Time

- Initial review: Within 24 hours
- Follow-up responses: Within 24 hours
- If you can't review in time, let the author know

## Resolving Disagreements

1. Discuss in PR comments
2. If stuck, sync call or async discussion
3. Default to the person doing the work, unless it's a blocking issue
4. For architectural decisions, document in ADR

---

Remember: Code review is about making the code better, not proving who's right. We're all on the same team. 🤝
