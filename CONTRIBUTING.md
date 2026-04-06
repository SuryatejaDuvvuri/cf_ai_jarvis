# Contributing to PanelAI

Thank you for your interest in contributing to PanelAI! This document provides guidelines and information for contributors.

## Table of Contents

- [Code of Conduct](#code-of-conduct)
- [Getting Started](#getting-started)
- [Development Workflow](#development-workflow)
- [Commit Guidelines](#commit-guidelines)
- [Pull Request Process](#pull-request-process)
- [Code Style](#code-style)
- [Testing](#testing)

## Code of Conduct

Please be respectful and constructive in all interactions. We're building something together.

## Getting Started

### Prerequisites

- Node.js 20+
- npm 10+
- A Cloudflare account (for deployment)

### Setup

```bash
# Clone the repository
git clone <repo-url>
cd panelai

# Install dependencies
npm install

# Copy environment variables
cp .dev.vars.example .dev.vars
# Edit .dev.vars with your API keys

# Start development server
npm run dev
```

## Development Workflow

1. **Create a branch** from `main`:

   ```bash
   git checkout -b feat/your-feature-name
   # or
   git checkout -b fix/your-bug-fix
   ```

2. **Make your changes** following our code style guidelines

3. **Write/update tests** for your changes

4. **Run checks locally**:

   ```bash
   npm run check    # Lint, format, typecheck
   npm run test     # Run tests
   ```

5. **Commit your changes** using conventional commits (see below)

6. **Push and create a PR**

## Commit Guidelines

We use [Conventional Commits](https://www.conventionalcommits.org/). Each commit message should be structured as:

```
type(scope): subject

[optional body]

[optional footer]
```

### Types

- `feat`: A new feature
- `fix`: A bug fix
- `docs`: Documentation changes
- `style`: Code style changes (formatting, semicolons, etc.)
- `refactor`: Code changes that neither fix bugs nor add features
- `perf`: Performance improvements
- `test`: Adding or updating tests
- `build`: Build system or external dependency changes
- `ci`: CI/CD configuration changes
- `chore`: Other changes that don't modify src or test files

### Scopes

- `agents`: @panelai/agents package
- `core`: @panelai/core package
- `shared`: @panelai/shared package
- `frontend`: @panelai/frontend package
- `worker`: @panelai/worker package
- `ci`: CI/CD related
- `docs`: Documentation
- `deps`: Dependencies

### Examples

```
feat(agents): add technical interviewer agent
fix(core): resolve shared memory race condition
docs(adr): document A2A protocol decision
test(worker): add integration tests for panel interview flow
chore(ci): add staging deployment step
```

## Pull Request Process

1. Ensure your PR description clearly describes the problem and solution
2. Link any related issues
3. Ensure all checks pass (CI will run automatically)
4. Request review from a maintainer
5. Address any review feedback
6. Once approved, a maintainer will merge your PR

### PR Title Format

PR titles should follow the same format as commit messages:

```
type(scope): brief description
```

## Code Style

- We use **Prettier** for formatting
- We use **Biome** for linting
- We use **TypeScript** with strict mode
- Run `npm run format` to auto-format code
- Run `npm run check` to verify everything passes

### Key Principles

1. **Human-in-the-loop by design**: AI recommends, humans decide
2. **Trust + verify**: Always explain complex code with comments
3. **Type safety**: Prefer explicit types over `any`
4. **Testability**: Write code that's easy to test

## Testing

- Every new function should have a unit test
- Every agent should have integration tests
- Every API route should have request/response tests
- Target: 80% coverage per package

### Running Tests

```bash
# Run all tests
npm run test

# Run tests for a specific package
npm run test --workspace=@panelai/worker

# Run tests in watch mode (from package directory)
cd packages/worker && npm run test -- --watch
```

## Questions?

If you have questions, feel free to:

- Open an issue for discussion
- Reach out to maintainers

Thank you for contributing! 🎉
