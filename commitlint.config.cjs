/**
 * Commitlint configuration
 * Enforces conventional commit format:
 *   type(scope): subject
 * 
 * Examples:
 *   feat(agents): add technical interviewer agent
 *   fix(core): resolve shared memory race condition
 *   docs(adr): document A2A protocol decision
 */
module.exports = {
  extends: ['@commitlint/config-conventional'],
  rules: {
    'scope-enum': [
      2,
      'always',
      [
        'agents',
        'core',
        'shared',
        'frontend',
        'worker',
        'ci',
        'docs',
        'adr',
        'deps'
      ]
    ],
    'type-enum': [
      2,
      'always',
      [
        'feat',
        'fix',
        'docs',
        'style',
        'refactor',
        'perf',
        'test',
        'build',
        'ci',
        'chore',
        'revert'
      ]
    ]
  }
};
